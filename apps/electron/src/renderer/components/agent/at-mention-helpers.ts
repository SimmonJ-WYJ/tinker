/**
 * AtMentionPanel 辅助纯函数：Collection 路径拼接 + 模糊过滤。
 */

import type { CollectionSummary } from '@asci/core/zotero'

export interface CollectionWithPath {
  key: string
  name: string
  parentKey: string | null
  /** 形如 "Parent / Child / Grandchild" */
  path: string
  /** 层级深度：根（parentKey === null）为 0，每深一层 +1。供树形缩进用。 */
  depth: number
}

/**
 * 给每个 Collection 拼一条从根到自身的 "A / B / C" 路径，并按树形 DFS 先序排序
 * （父紧跟其整棵子树，同级按名字本地化排序），便于面板按 depth 缩进渲染成树。
 */
export function buildCollectionPathList(
  collections: CollectionSummary[],
): CollectionWithPath[] {
  const byKey = new Map<string, CollectionSummary>()
  for (const c of collections) byKey.set(c.key, c)

  const pathCache = new Map<string, string>()
  const resolve = (key: string, seen: Set<string>): string => {
    if (pathCache.has(key)) return pathCache.get(key)!
    const node = byKey.get(key)
    if (!node) return '?'
    if (seen.has(key)) return node.name
    seen.add(key)
    const parentPath = node.parentKey === null ? '' : resolve(node.parentKey, seen)
    const joined = parentPath ? `${parentPath} / ${node.name}` : node.name
    pathCache.set(key, joined)
    return joined
  }

  const withPath = collections.map((c) => {
    const path = resolve(c.key, new Set())
    return {
      key: c.key,
      name: c.name,
      parentKey: c.parentKey,
      path,
      depth: path.split(' / ').length - 1,
    }
  })
  return sortCollectionsForTree(withPath)
}

/**
 * 把扁平 Collection 列表排成树形 DFS 先序：父节点紧跟其整棵子树，同级按名字本地化排序。
 * Zotero 原始 listCollections 顺序无序，直接缩进渲染不成树，故客户端自行排序。
 * 纯函数；不改入参。
 */
export function sortCollectionsForTree(
  list: CollectionWithPath[],
): CollectionWithPath[] {
  const childrenOf = new Map<string | null, CollectionWithPath[]>()
  for (const c of list) {
    const group = childrenOf.get(c.parentKey)
    if (group) group.push(c)
    else childrenOf.set(c.parentKey, [c])
  }
  for (const group of childrenOf.values()) {
    group.sort((a, b) => a.name.localeCompare(b.name))
  }

  const out: CollectionWithPath[] = []
  const visit = (parentKey: string | null): void => {
    for (const node of childrenOf.get(parentKey) ?? []) {
      out.push(node)
      visit(node.key)
    }
  }
  visit(null)
  // 父节点缺失（被过滤/数据异常）的孤儿不会经 visit(null) 命中，补挂到尾部避免丢失
  if (out.length < list.length) {
    const seen = new Set(out.map((c) => c.key))
    for (const c of list) if (!seen.has(c.key)) out.push(c)
  }
  return out
}

/** 名字子串命中 OR 路径任一段精确命中，大小写不敏感；空查询返回全部。 */
export function filterCollectionsByQuery(
  list: CollectionWithPath[],
  query: string,
): CollectionWithPath[] {
  const q = query.trim().toLowerCase()
  if (!q) return list
  return list.filter((c) => {
    if (c.name.toLowerCase().includes(q)) return true
    const segments = c.path.split(' / ')
    return segments.some((seg) => seg.toLowerCase() === q)
  })
}

// ---- AtMention 面板层级导航状态模型 ----

/**
 * 面板层级 kind：
 * - root: 根层（选"项目文件" / "文献库" / "证据集"）
 * - project-files: 叶子，项目附件列表
 * - library-root: 文献库 L1（全部条目 + 类目）
 * - library-all-items: 叶子，全部条目
 * - library-collection: 叶子，某类目条目（payload: collectionKey）
 * - evidence-set-list: 叶子，当前 workspace 的命名证据集列表（issue #449）
 */
export type AtMentionLevelKind =
  | 'root'
  | 'project-files'
  | 'library-root'
  | 'library-all-items'
  | 'library-collection'
  | 'evidence-set-list'

export interface AtMentionLevel {
  kind: AtMentionLevelKind
  /** 该层的查询字符串；新入栈时固定为空，由调用方随输入更新。 */
  query: string
  /** 该层当前高亮项下标。 */
  index: number
  /** 仅 library-collection 使用。 */
  collectionKey?: string
}

export interface AtMentionNavState {
  /** 从根到当前层的栈，首项恒为 root。 */
  stack: AtMentionLevel[]
}

/** 初始态：仅根层。 */
export function createInitialNavState(): AtMentionNavState {
  return { stack: [{ kind: 'root', query: '', index: 0 }] }
}

/** 读取栈顶层级。栈永远非空（root 始终存在）。 */
export function getCurrentLevel(state: AtMentionNavState): AtMentionLevel {
  const top = state.stack[state.stack.length - 1]
  if (!top) throw new Error('AtMentionNavState.stack must never be empty')
  return top
}

/** 描述"从当前层选中的项要跳到哪一级"。 */
export type AtMentionEnterTarget =
  | { kind: 'project-files' }
  | { kind: 'library-root' }
  | { kind: 'library-all-items' }
  | { kind: 'library-collection'; collectionKey: string }
  | { kind: 'evidence-set-list' }

/** 校验给定当前层 kind 下，target 是否是合法的下钻目标。 */
function isLegalTransition(
  from: AtMentionLevelKind,
  to: AtMentionLevelKind,
): boolean {
  if (from === 'root')
    return to === 'project-files' || to === 'library-root' || to === 'evidence-set-list'
  if (from === 'library-root')
    return to === 'library-all-items' || to === 'library-collection'
  // project-files / library-all-items / library-collection / evidence-set-list 都是叶子，不可再下钻
  return false
}

/**
 * 从当前层进入下一级。
 * - 非法转移抛错
 * - 新层 query='' index=0
 *
 * 注意：进入 library-root 永远成功；Zotero 是否启用由面板层根据
 * `status.zoteroEnabled === false` 渲染占位，而非在此阻止下钻。
 */
export function enterLevel(
  state: AtMentionNavState,
  target: AtMentionEnterTarget,
): AtMentionNavState {
  const current = getCurrentLevel(state)
  if (!isLegalTransition(current.kind, target.kind)) {
    throw new Error(
      `AtMention 导航非法转移：${current.kind} -> ${target.kind}`,
    )
  }
  const next: AtMentionLevel = {
    kind: target.kind,
    query: '',
    index: 0,
    collectionKey:
      target.kind === 'library-collection' ? target.collectionKey : undefined,
  }
  return { stack: [...state.stack, next] }
}

/**
 * 返回上一级；若已在根层（栈仅 1 项），返回原 state（引用相等作为边界标记，
 * 调用方可用 `next === state` 判断是否应关闭面板）。
 */
export function goBack(state: AtMentionNavState): AtMentionNavState {
  if (state.stack.length <= 1) return state
  return { stack: state.stack.slice(0, -1) }
}

// ---- Item 语义辅助（供 panel + suggestion 共用） ----

/**
 * 抽象 AtMention 面板中的 Item 判定，避免 panel/suggestion 两端重复 `kind` 分支。
 * 此处使用结构化类型（只看 kind），与 AtMentionPanel 中的具体 Item 形状解耦。
 */
type AtMentionItemLike =
  | { kind: 'file' }
  | { kind: 'zotero-col'; col: { key: string } }
  | { kind: 'zotero-item' }
  | { kind: 'category'; target: 'project-files' | 'library-root' | 'evidence-set-list' }
  | { kind: 'library-all-items' }
  | { kind: 'evidence-set' }

/**
 * 是否叶子项（Enter/→ 都插入 chip，不可再下钻）。
 * 注意：`zotero-col` 不视为叶子——它既可插入（Enter 默认）也可下钻（→ 进入该类目）。
 */
export function isLeaf(item: AtMentionItemLike): boolean {
  return item.kind === 'file' || item.kind === 'zotero-item' || item.kind === 'evidence-set'
}

/**
 * 把一个 Item 映射成"下钻目标"；不可下钻时返回 null。
 * - category                  → 对应 target 层
 * - library-all-items         → 'library-all-items'
 * - zotero-col                → 'library-collection' (携带 collectionKey)
 * - file / zotero-item / evidence-set → null（叶子）
 */
export function toDrillTarget(item: AtMentionItemLike): AtMentionEnterTarget | null {
  if (item.kind === 'category') return { kind: item.target }
  if (item.kind === 'library-all-items') return { kind: 'library-all-items' }
  if (item.kind === 'zotero-col')
    return { kind: 'library-collection', collectionKey: item.col.key }
  return null
}

/**
 * 清理栈顶所有"失效"的 library-collection 层级：
 * - 自栈顶向下扫描，遇到 `library-collection` 且其 `collectionKey` 不在 `validCollectionKeys` 中，
 *   就把该层连同其上方全部弹出（因为上方都是基于该失效类目的再下钻，也没有恢复意义）。
 * - 若途中发现 `library-root` 仍然合法（所属 cache 已加载），停在 `library-root`。
 * - 若连 `library-root` 之下的所有 collection 均失效，回退到 `library-root`；
 *   如果 `library-root` 自身也失效（cache 为空时由调用方保证不进入），至少保留根层。
 *
 * 返回新的 state；若栈完全未变，返回原 state 引用（便于引用相等比较）。
 */
export function pruneStaleLevels(
  state: AtMentionNavState,
  validCollectionKeys: ReadonlySet<string>,
): AtMentionNavState {
  // 找到第一个"失效的 library-collection"层下标（从底向上扫描）
  let cutIdx = -1
  for (let i = 1; i < state.stack.length; i++) {
    const lv = state.stack[i]!
    if (lv.kind === 'library-collection') {
      const key = lv.collectionKey
      if (!key || !validCollectionKeys.has(key)) {
        cutIdx = i
        break
      }
    }
  }
  if (cutIdx === -1) return state
  // 弹出 cutIdx 及其之上的所有层
  return { stack: state.stack.slice(0, cutIdx) }
}

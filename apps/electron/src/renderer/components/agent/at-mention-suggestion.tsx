import { RESEARCH_UI_ENABLED } from '@/lib/product-surface'
/**
 * createAtMentionSuggestion — @ 触发的 TipTap Suggestion 工厂
 *
 * 层级导航模式：
 * - 根层（root）：两个分类入口（项目文件 / 文献库）
 * - 项目文件（project-files）：文件列表（叶子）
 * - 文献库根（library-root）："全部条目" + 类目列表
 * - 全部条目（library-all-items）：20 条条目（叶子）
 * - 类目条目（library-collection）：某类目下条目（叶子）
 *
 * 模块级 lastNavState 跨会话粘性保存导航状态（仅内存，不持久化）。
 */

import * as React from 'react'
import { ReactRenderer } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import type { PluginKey } from '@tiptap/pm/state'
import type { SuggestionOptions } from '@tiptap/suggestion'
import { exitSuggestion } from '@tiptap/suggestion'

type EditorView = Editor['view']
import { createMentionPopup, positionPopup } from './mention-popup-utils'
import {
  AtMentionPanel,
  type AtMentionPanelRef,
  type AtMentionItem,
  type AtMentionStatus,
  type AtMentionBreadcrumbItem,
  type AtMentionRootHint,
} from './AtMentionPanel'
import { i18n } from '@/lib/i18n'
import {
  buildCollectionPathList,
  filterCollectionsByQuery,
  createInitialNavState,
  getCurrentLevel,
  enterLevel,
  goBack,
  isLeaf,
  toDrillTarget,
  pruneStaleLevels,
  type CollectionWithPath,
  type AtMentionNavState,
  type AtMentionLevel,
} from './at-mention-helpers'
import type { ItemSummary, CollectionSummary } from '@asci/core/zotero'
import type { MentionKind, EvidenceSetSummary } from '@asci/shared'

// 会话内粘性：跨 Mention 激活保留最近导航状态
let lastNavState: AtMentionNavState = createInitialNavState()

/**
 * 计算文件来源的绝对路径，供 @ 面板展示用户「从哪获取该文件」。
 * - 附加目录文件：entry.path 已是绝对路径，原样返回
 * - 工作区文件：entry.path 是相对 wsPath 的路径，拼成绝对路径
 * entry.path 本身保持相对（仍作为 mention id 注入），不受影响。
 */
function computeFileSourcePath(wsPath: string, entryPath: string): string {
  if (entryPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(entryPath)) return entryPath
  const sep = wsPath.includes('\\') ? '\\' : '/'
  return `${wsPath.replace(/[\\/]+$/, '')}${sep}${entryPath}`
}

export interface AtMentionSuggestionConfig {
  workspacePathRef: React.RefObject<string | null>
  /** 当前 agent workspace id（issue #457/#449）；用于列出该 workspace 的证据集。 */
  workspaceIdRef: React.RefObject<string | null>
  attachedDirsRef: React.RefObject<string[]>
  mentionActiveRef: React.MutableRefObject<boolean>
  mentionItemCountRef: React.MutableRefObject<number>
  /**
   * 当前 @ Suggestion 实例的 PluginKey（来自 rich-text-input.tsx 显式注入）。
   * TipTap Mention 扩展为每个 suggestions[] 条目生成独立 PluginKey，若此处不传，
   * exitSuggestion 会回退到默认 SuggestionPluginKey —— 对应的 exit meta 会被
   * 活跃插件忽略，导致根层 ← 关闭面板失效（僵尸面板 bug）。
   * 调用方必须把同一个 PluginKey 同时注入 Mention.configure 的 suggestions[] 条目。
   */
  pluginKey: PluginKey
  /** 用于 Zotero 可用性检查的状态 getter（每次调用返回最新 status） */
  getStatus: () => AtMentionStatus
  /** 类目选中回调（上层负责副作用） */
  onCollectionSelect?: (col: CollectionWithPath) => void
  /** 条目选中回调（上层负责缓存 ItemSummary + PDF 附挂） */
  onItemSelect?: (item: ItemSummary) => void
  /** 启动 Zotero 回调（zoteroRunning=false 时面板里的按钮） */
  onLaunchZotero?: () => void
  /**
   * Mention 选中回调：选中项被推到上层维护的 pendingMentions 列表，
   * 而不是 inline 插入编辑器。chip 行会渲染在编辑器上方。
   */
  onMentionAdd?: (mention: { kind: MentionKind; id: string; label: string }) => void
}

export function createAtMentionSuggestion(
  cfg: AtMentionSuggestionConfig,
): Omit<SuggestionOptions<AtMentionItem>, 'editor'> {
  // Collection 树缓存（首次 library-root 层激活时拉一次）
  let collectionsCache: CollectionWithPath[] | null = null
  let collectionsError: string | undefined = undefined
  let collectionsLoading = false

  // 证据集列表缓存（首次 evidence-set-list 层激活时按 workspace 拉一次，之后本地过滤；
  // 与 collectionsCache 同源思路，避免每次按键 refetch）。workspace 变化时缓存失效重拉。
  let evidenceSetsCache: EvidenceSetSummary[] | null = null
  let evidenceSetsCacheWorkspaceId: string | null = null

  const ensureEvidenceSets = async (workspaceId: string): Promise<void> => {
    if (evidenceSetsCache && evidenceSetsCacheWorkspaceId === workspaceId) return
    try {
      evidenceSetsCache = await window.electronAPI.evidenceSets.listSummary({
        workspaceId,
        persistedOnly: true,
      })
      evidenceSetsCacheWorkspaceId = workspaceId
    } catch {
      evidenceSetsCache = []
      evidenceSetsCacheWorkspaceId = workspaceId
    }
  }

  // 当用户没有自建 collection 时（Zotero 默认状态），用来填"X 条文献"提示。
  // 拉一次顶层条目（限 200）作为近似总数；超过 200 显示 "200+"。
  const TOP_ITEMS_PROBE_LIMIT = 200
  let topItemsCount: number | null = null
  let topItemsLoading = false

  const ensureTopItemsCount = async (): Promise<void> => {
    if (topItemsCount !== null || topItemsLoading) return
    topItemsLoading = true
    try {
      const items = await window.electronAPI.zotero.library.getCollectionItems({
        collectionKey: null,
        limit: TOP_ITEMS_PROBE_LIMIT,
      })
      topItemsCount = items.length
    } catch {
      topItemsCount = null
    } finally {
      topItemsLoading = false
    }
  }

  const ensureCollections = async (): Promise<void> => {
    if (collectionsCache || collectionsLoading) return
    collectionsLoading = true
    try {
      const raw: CollectionSummary[] = await window.electronAPI.zotero.library.listCollections()
      collectionsCache = buildCollectionPathList(raw)
      collectionsError = undefined
    } catch (e) {
      collectionsError = i18n.t('atMention.zotero.error.loadFailedPrefix', {
        ns: 'conversation',
        message: (e as Error).message,
      })
    } finally {
      collectionsLoading = false
    }
  }

  /**
   * 派生根层两条目的描述文案的语义化描述符。纯函数，仅读取已有 ref / cache / status，不发起 IPC。
   * 实际本地化由 panel 用 i18n 解析；这里只决定 key 与变量。
   * 时序：首次 onStart 时 cache 为 null + 触发预热 → 显示"加载中"；预热完成后下次 refreshPanel 显示真实计数。
   */
  const computeRootHints = (
    status: AtMentionStatus,
  ): { projectFiles: AtMentionRootHint; library: AtMentionRootHint; evidenceSet: AtMentionRootHint } => {
    const wsPath = cfg.workspacePathRef.current
    const attached = cfg.attachedDirsRef.current ?? []
    let projectFiles: AtMentionRootHint
    if (wsPath) {
      const basename =
        wsPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ||
        i18n.t('atMention.rootHints.workspaceFallbackName', { ns: 'conversation' })
      projectFiles = attached.length > 0
        ? {
            kind: 'i18nCount',
            key: 'atMention.rootHints.workspaceWithDirs',
            count: attached.length,
            vars: { name: basename },
          }
        : {
            kind: 'i18n',
            key: 'atMention.rootHints.workspaceOnly',
            vars: { name: basename },
          }
    } else {
      projectFiles = { kind: 'i18n', key: 'atMention.rootHints.noWorkspace' }
    }

    let library: AtMentionRootHint
    if (!status.zoteroEnabled) library = { kind: 'i18n', key: 'atMention.rootHints.zotero.disabled' }
    else if (!status.zoteroRunning) library = { kind: 'i18n', key: 'atMention.rootHints.zotero.notRunning' }
    else if (collectionsError) library = { kind: 'i18n', key: 'atMention.rootHints.zotero.loadFailed' }
    else if (collectionsCache === null) library = { kind: 'i18n', key: 'atMention.rootHints.zotero.loading' }
    else if (collectionsCache.length === 0) {
      // 无自建 collection 时退化为顶层条目数；探针未回前先显示连接态
      if (topItemsCount === null) library = { kind: 'i18n', key: 'atMention.rootHints.zotero.connected' }
      else if (topItemsCount >= TOP_ITEMS_PROBE_LIMIT)
        library = {
          kind: 'i18n',
          key: 'atMention.rootHints.zotero.papersCountOver',
          vars: { limit: TOP_ITEMS_PROBE_LIMIT },
        }
      else
        library = {
          kind: 'i18nCount',
          key: 'atMention.rootHints.zotero.papersCount',
          count: topItemsCount,
        }
    }
    else
      library = {
        kind: 'i18nCount',
        key: 'atMention.rootHints.zotero.collectionsCount',
        count: collectionsCache.length,
      }

    const evidenceSet: AtMentionRootHint = cfg.workspaceIdRef.current
      ? { kind: 'i18n', key: 'atMention.rootHints.evidenceSet' }
      : { kind: 'i18n', key: 'atMention.rootHints.evidenceSetNoWorkspace' }

    return { projectFiles, library, evidenceSet }
  }

  /**
   * 根层激活时预热缓存。两阶段：
   *   1) collection 树（首要）—— 拿到后能立即显示 collection 数
   *   2) 若 collection 数为 0，再拉顶层条目数，把"Zotero 已连接"升级成"X 条文献"
   */
  const maybePreheatCollections = (refresh: () => void): void => {
    const level = getCurrentLevel(lastNavState)
    if (!RESEARCH_UI_ENABLED || level.kind !== 'root') return
    const status = cfg.getStatus()
    if (!status.zoteroEnabled || !status.zoteroRunning) return
    if (collectionsCache !== null) {
      // collection 已加载；若是空集且条目数还未探针，则补一次
      if (collectionsCache.length === 0 && topItemsCount === null && !topItemsLoading) {
        void (async () => {
          await ensureTopItemsCount()
          refresh()
        })()
      }
      return
    }
    if (collectionsLoading) return
    void (async () => {
      await ensureCollections()
      refresh()
      // ensureCollections 完成后 collectionsCache 可能已被填充；TS 闭包窄化无法感知，绕过窄化读取
      const cacheLen = (collectionsCache as CollectionWithPath[] | null)?.length
      if (cacheLen === 0) {
        await ensureTopItemsCount()
        refresh()
      }
    })()
  }

  /** 按层级拉取 items */
  const fetchItemsForLevel = async (
    level: AtMentionLevel,
    query: string,
  ): Promise<AtMentionItem[]> => {
    const status = cfg.getStatus()
    const q = query.toLowerCase()

    if (level.kind === 'root') {
      const categories: AtMentionItem[] = [
        { kind: 'category', target: 'project-files', labelKey: 'atMention.category.projectFiles', icon: 'folder' },
        { kind: 'category', target: 'library-root', labelKey: 'atMention.category.library', icon: 'book' },
        { kind: 'category', target: 'evidence-set-list', labelKey: 'atMention.category.evidenceSet', icon: 'layers' },
      ]
      return RESEARCH_UI_ENABLED ? categories : categories.filter(item => item.kind === 'category' && item.target === 'project-files')
    }

    if (level.kind === 'evidence-set-list') {
      const workspaceId = cfg.workspaceIdRef.current
      if (!workspaceId) return []
      await ensureEvidenceSets(workspaceId)
      const sets = evidenceSetsCache ?? []
      const filtered = q
        ? sets.filter((s) => (s.name ?? '').toLowerCase().includes(q))
        : sets
      return filtered.slice(0, 50).map((set) => ({ kind: 'evidence-set' as const, set }))
    }

    if (level.kind === 'project-files') {
      const wsPath = cfg.workspacePathRef.current
      if (!wsPath) return []
      try {
        const attached = cfg.attachedDirsRef.current ?? []
        const result = await window.electronAPI.searchWorkspaceFiles(
          wsPath,
          query,
          20,
          attached.length > 0 ? attached : undefined,
        )
        return result.entries.map((e) => ({
          kind: 'file' as const,
          entry: e,
          sourcePath: computeFileSourcePath(wsPath, e.path),
        }))
      } catch {
        return []
      }
    }

    // 以下均为 Zotero 层级
    if (!status.zoteroEnabled || !status.zoteroRunning) return []

    if (level.kind === 'library-root') {
      await ensureCollections()
      if (!collectionsCache) return []
      // 用户没有任何自建 collection 时（仅有 Zotero 内置虚拟夹），
      // 跳过"全部条目"中转层，直接展示顶层条目，避免多余一次跳转。
      if (collectionsCache.length === 0) {
        try {
          const items: ItemSummary[] = q
            ? await window.electronAPI.zotero.library.searchItems({ query: q, limit: 20 })
            : await window.electronAPI.zotero.library.getCollectionItems({
                collectionKey: null,
                limit: 20,
              })
          return items.map((i) => ({ kind: 'zotero-item' as const, item: i }))
        } catch {
          return []
        }
      }
      const cols = filterCollectionsByQuery(collectionsCache, q)
        .slice(0, 50)
        .map((c) => ({ kind: 'zotero-col' as const, col: c }))
      // 查询为空时头部插入"全部条目"入口；有查询时隐藏
      if (!q) {
        return [
          { kind: 'library-all-items', labelKey: 'atMention.allItems' },
          ...cols,
        ]
      }
      return cols
    }

    if (level.kind === 'library-all-items') {
      try {
        const items: ItemSummary[] = q
          ? await window.electronAPI.zotero.library.searchItems({ query: q, limit: 20 })
          : await window.electronAPI.zotero.library.getCollectionItems({
              collectionKey: null,
              limit: 20,
            })
        return items.map((i) => ({ kind: 'zotero-item' as const, item: i }))
      } catch {
        return []
      }
    }

    if (level.kind === 'library-collection') {
      if (!level.collectionKey) return []
      try {
        const items: ItemSummary[] = await window.electronAPI.zotero.library.getCollectionItems({
          collectionKey: level.collectionKey,
          limit: 20,
        })
        // 本地 query 过滤（标题子串）
        const filtered = q
          ? items.filter((i) => i.title.toLowerCase().includes(q))
          : items
        return filtered.map((i) => ({ kind: 'zotero-item' as const, item: i }))
      } catch {
        return []
      }
    }

    return []
  }

  /** library-root 在用户无自建 collection 时，会内联展示顶层条目；面板用此标志切换搜索/键位提示。 */
  const isLibraryRootInlineItems = (level: AtMentionLevel): boolean =>
    level.kind === 'library-root' && collectionsCache !== null && collectionsCache.length === 0

  /** 根据 navState 计算面包屑标签列表（不含根层本身，根层无标签显示） */
  const computeBreadcrumb = (state: AtMentionNavState): AtMentionBreadcrumbItem[] => {
    const crumbs: AtMentionBreadcrumbItem[] = []
    for (let i = 1; i < state.stack.length; i++) {
      const lv = state.stack[i]!
      if (lv.kind === 'project-files') crumbs.push({ kind: 'i18n', key: 'atMention.breadcrumb.projectFiles' })
      else if (lv.kind === 'evidence-set-list') crumbs.push({ kind: 'i18n', key: 'atMention.breadcrumb.evidenceSet' })
      else if (lv.kind === 'library-root') crumbs.push({ kind: 'i18n', key: 'atMention.breadcrumb.library' })
      else if (lv.kind === 'library-all-items') crumbs.push({ kind: 'i18n', key: 'atMention.breadcrumb.allItems' })
      else if (lv.kind === 'library-collection') {
        const col = collectionsCache?.find((c) => c.key === lv.collectionKey)
        if (col?.path) crumbs.push({ kind: 'literal', text: col.path })
        else crumbs.push({ kind: 'i18n', key: 'atMention.breadcrumb.collectionFallback' })
      }
    }
    return crumbs
  }

  return {
    char: '@',
    allowSpaces: false,
    pluginKey: cfg.pluginKey,

    /**
     * 覆盖 Mention 默认 command：不再把 chip 节点写进编辑器，仅清掉 @ 触发字符。
     * mention 的真实"选中"已经在 insertChip 里通过 cfg.onMentionAdd 推到 pendingMentions。
     */
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
    },

    items: async ({ query }): Promise<AtMentionItem[]> => {
      const level = getCurrentLevel(lastNavState)
      return fetchItemsForLevel(level, query ?? '')
    },

    render: () => {
      let renderer: ReactRenderer<AtMentionPanelRef> | null = null
      let popup: HTMLDivElement | null = null
      let currentQuery = ''
      let currentClientRect: (() => DOMRect | null) | null = null
      let commandFn: ((attrs: Record<string, unknown>) => void) | null = null
      // 保留 editor.view 引用，用于从代码路径（根层 ← / 面板 Esc）主动退出 Suggestion 插件，
      // 避免仅销毁 popup/renderer 而插件仍处于激活态，导致同一 @ 范围后续输入无法重建面板。
      let editorView: EditorView | null = null
      // 点击 popup 外部 + 编辑器外部时退出 Suggestion（避免面板卡住无法关闭）
      let handleDocMouseDown: ((e: MouseEvent) => void) | null = null
      // 编辑器失焦（如设置浮窗打开后 Radix Dialog 自动聚焦）时退出 Suggestion，
      // 避免 popup 孤悬在 z-index 9999 上盖住其他对话框。
      let handleEditorFocusOut: ((e: FocusEvent) => void) | null = null
      let editorDomRef: HTMLElement | null = null

      const refreshPanel = async (): Promise<void> => {
        if (!renderer) return
        maybePreheatCollections(() => { void refreshPanel() })
        // 若当前层依赖的 collection 已从缓存中失效（cache 刷新后某类目被删），
        // 先裁掉失效层再渲染，避免进入"空列表 + 标题悬空"的坏状态。
        if (collectionsCache) {
          const validKeys = new Set(collectionsCache.map((c) => c.key))
          const pruned = pruneStaleLevels(lastNavState, validKeys)
          if (pruned !== lastNavState) lastNavState = pruned
        }
        const level = getCurrentLevel(lastNavState)
        const nextItems = await fetchItemsForLevel(level, currentQuery)
        cfg.mentionItemCountRef.current = nextItems.length
        const status = { ...cfg.getStatus(), zoteroError: collectionsError }
        renderer.updateProps({
          level,
          items: nextItems,
          query: currentQuery,
          breadcrumb: computeBreadcrumb(lastNavState),
          status,
          libraryRootInlineItems: isLibraryRootInlineItems(level),
          rootHints: computeRootHints(status),
        })
        requestAnimationFrame(() => {
          positionPopup(popup, currentClientRect?.() ?? null)
        })
      }

      /** 下钻：category / library-all-items / zotero-col 入栈 */
      const drillInto = (item: AtMentionItem): void => {
        const target = toDrillTarget(item)
        if (!target) return
        // 进入 library-root 无条件成功；Zotero 未启用时由面板层渲染占位。
        const next = enterLevel(lastNavState, target)
        if (next === lastNavState) return
        lastNavState = next
        void refreshPanel()
      }

      /**
       * 选中 mention：推到 pendingMentions（外部状态），同时调 commandFn 触发覆盖后的
       * suggestion command —— 仅清掉 @ 触发字符，不再 inline 插入 chip 节点。
       */
      const insertChip = (item: AtMentionItem): void => {
        if (!commandFn) return
        if (item.kind === 'file') {
          // 递归扫描会带出目录项；目录引用为 kind 'dir'（发送时主消息展开成文件清单）。
          cfg.onMentionAdd?.({
            kind: item.entry.type === 'dir' ? 'dir' : 'file',
            id: item.entry.path,
            label: item.entry.name,
          })
          commandFn({})
          return
        }
        if (item.kind === 'zotero-col') {
          cfg.onMentionAdd?.({ kind: 'zotero-col', id: item.col.key, label: item.col.path })
          commandFn({})
          cfg.onCollectionSelect?.(item.col)
          return
        }
        if (item.kind === 'zotero-item') {
          cfg.onMentionAdd?.({ kind: 'zotero-item', id: item.item.key, label: item.item.title })
          commandFn({})
          cfg.onItemSelect?.(item.item)
          return
        }
        if (item.kind === 'evidence-set') {
          cfg.onMentionAdd?.({
            kind: 'evidence-set',
            id: item.set.id,
            label: item.set.name ?? i18n.t('atMention.evidenceSet.untitled', { ns: 'conversation' }),
          })
          commandFn({})
        }
      }

      const handleEnter = (item: AtMentionItem): void => {
        // Enter 语义：叶子 + zotero-col 都插入自身；其余分支入口（category / library-all-items）下钻。
        if (isLeaf(item) || item.kind === 'zotero-col') {
          insertChip(item)
          return
        }
        drillInto(item)
      }

      const handleDrill = (item: AtMentionItem): void => {
        // → 语义：叶子视为 insert，可下钻项（含 zotero-col）则下钻。
        if (isLeaf(item)) {
          insertChip(item)
          return
        }
        drillInto(item)
      }

      const handleClose = (): void => {
        // 统一走 TipTap 的 exit 通道：dispatch exit meta 事务 → 插件 deactivate →
        // 触发 onExit 回调完成 popup/renderer 清理。避免"只销毁 UI 但插件仍激活"导致的僵尸状态。
        // 必须传入具名 pluginKey：TipTap Mention 为每个 suggestions[] 条目创建独立 PluginKey，
        // 默认 SuggestionPluginKey 不是当前激活插件，exit meta 会被忽略。
        if (editorView) {
          exitSuggestion(editorView, cfg.pluginKey)
          return
        }
        // Fallback：editorView 尚未就绪时手动清理（理论上不会走到这里）
        popup?.remove()
        popup = null
        renderer?.destroy()
        renderer = null
        cfg.mentionActiveRef.current = false
        cfg.mentionItemCountRef.current = 0
      }

      const handleBack = (): void => {
        const next = goBack(lastNavState)
        if (next === lastNavState) {
          // 根层 ← 关闭面板：走 exitSuggestion 通知 TipTap 退出，清理由 onExit 负责
          handleClose()
          return
        }
        lastNavState = next
        void refreshPanel()
      }

      /** Panel 高亮 index 变化时同步写回当前层级的 navState，使层间返回能恢复光标位置。 */
      const handleIndexChange = (idx: number): void => {
        const stack = lastNavState.stack
        const top = stack[stack.length - 1]
        if (!top || top.index === idx) return
        lastNavState = {
          stack: [...stack.slice(0, -1), { ...top, index: idx }],
        }
      }

      const handleBreadcrumbJump = (levelIndex: number): void => {
        // levelIndex 是面包屑下标（不含根层），对应 stack 下标 = levelIndex + 1
        const targetStackIdx = levelIndex + 1
        if (targetStackIdx < 1 || targetStackIdx >= lastNavState.stack.length) return
        lastNavState = { stack: lastNavState.stack.slice(0, targetStackIdx + 1) }
        void refreshPanel()
      }

      const mountProps = (
        items: AtMentionItem[],
        command: (attrs: Record<string, unknown>) => void,
      ) => {
        commandFn = command
        const level = getCurrentLevel(lastNavState)
        const status = { ...cfg.getStatus(), zoteroError: collectionsError }
        return {
          level,
          items,
          query: currentQuery,
          breadcrumb: computeBreadcrumb(lastNavState),
          status,
          libraryRootInlineItems: isLibraryRootInlineItems(level),
          rootHints: computeRootHints(status),
          onEnter: handleEnter,
          onDrill: handleDrill,
          onBack: handleBack,
          onClose: handleClose,
          onBreadcrumbJump: handleBreadcrumbJump,
          onLaunchZotero: cfg.onLaunchZotero,
          onIndexChange: handleIndexChange,
        }
      }

      return {
        onStart(props) {
          cfg.mentionActiveRef.current = true
          cfg.mentionItemCountRef.current = props.items.length
          currentQuery = props.query ?? ''
          currentClientRect = props.clientRect ?? null
          editorView = props.editor.view
          renderer = new ReactRenderer(AtMentionPanel, {
            props: mountProps(props.items, props.command),
            editor: props.editor,
          })
          popup = createMentionPopup(renderer.element)
          positionPopup(popup, props.clientRect?.())

          maybePreheatCollections(() => { void refreshPanel() })

          // 监听全局点击：落在 popup / editor 之外时退出 Suggestion
          const editorDom = props.editor.view.dom
          editorDomRef = editorDom
          handleDocMouseDown = (e: MouseEvent) => {
            const target = e.target as Node | null
            if (!target) return
            if (popup?.contains(target)) return
            if (editorDom.contains(target)) return
            handleClose()
          }
          document.addEventListener('mousedown', handleDocMouseDown, true)

          // 编辑器失焦兜底：覆盖快捷键打开 Dialog / 焦点被其他可聚焦元素抢走等无 mousedown 的场景。
          // 焦点移进 popup 内部不视为关闭信号（虽然根 div 已 preventDefault 防焦点转移，仍保留这层防御）。
          handleEditorFocusOut = (e: FocusEvent) => {
            const next = e.relatedTarget as Node | null
            if (next && popup?.contains(next)) return
            handleClose()
          }
          editorDom.addEventListener('focusout', handleEditorFocusOut)
        },

        onUpdate(props) {
          cfg.mentionItemCountRef.current = props.items.length
          currentQuery = props.query ?? ''
          currentClientRect = props.clientRect ?? null
          renderer?.updateProps(mountProps(props.items, props.command))
          positionPopup(popup, props.clientRect?.())
        },

        onKeyDown(props) {
          return renderer?.ref?.onKeyDown({ event: props.event }) ?? false
        },

        onExit() {
          cfg.mentionActiveRef.current = false
          cfg.mentionItemCountRef.current = 0
          currentClientRect = null
          commandFn = null
          popup?.remove()
          popup = null
          renderer?.destroy()
          renderer = null
          editorView = null
          if (handleDocMouseDown) {
            document.removeEventListener('mousedown', handleDocMouseDown, true)
            handleDocMouseDown = null
          }
          if (handleEditorFocusOut && editorDomRef) {
            editorDomRef.removeEventListener('focusout', handleEditorFocusOut)
          }
          handleEditorFocusOut = null
          editorDomRef = null
        },
      }
    },
  }
}

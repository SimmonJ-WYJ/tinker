/**
 * Tab Atoms — 标签页状态管理
 *
 * 支持浏览器风格的多标签页，当前仅承载 Agent 会话。
 */

import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import {
  agentRunningSessionIdsAtom,
  agentSessionIndicatorMapAtom,
  currentAgentWorkspaceIdAtom,
} from './agent-atoms'
import type { SessionIndicatorStatus } from './agent-atoms'
import type { AgentSessionMeta } from '@asci/shared'

// ===== 类型定义 =====

/** 标签页类型（当前仅支持 agent；保留字面量字段便于未来扩展） */
export type TabType = 'agent'

/** 标签页数据 */
export interface TabItem {
  /** 唯一标签 ID（直接使用 sessionId） */
  id: string
  /** 标签页类型 */
  type: TabType
  /** Agent sessionId */
  sessionId: string
  /** 标签页显示标题 */
  title: string
  /**
   * 归属工作区 ID。缺省（review 投影 / legacy 会话）表示不归属任何工作区，
   * 在所有工作区均可见；tab 栏按 currentAgentWorkspaceIdAtom 过滤时以此为准。
   */
  workspaceId?: string
}

/** Tab 持久化数据（保存到 settings.json） */
export interface PersistedTabState {
  tabs: TabItem[]
  activeTabId: string | null
  /** 各工作区最后激活的 tab ID（切回工作区时还原） */
  activeTabIdByWorkspace?: Record<string, string>
}

// ===== 核心 Atoms =====

/** 所有打开的标签页列表（有序，控制 TabBar 显示顺序） */
export const tabsAtom = atom<TabItem[]>([])

/** 当前激活的标签 ID */
export const activeTabIdAtom = atom<string | null>(null)

/** 各工作区最后激活的 tab ID（key = workspaceId），切回工作区时优先还原 */
export const activeTabIdByWorkspaceAtom = atom<Record<string, string>>({})

/** 侧边栏是否收起（持久化） */
export const sidebarCollapsedAtom = atomWithStorage<boolean>(
  'asci-sidebar-collapsed',
  false,
)

/** Tab 迷你地图缓存（每个 Tab 的消息预览列表，在消息组件中填充） */
export interface TabMinimapItem {
  id: string
  role: 'user' | 'assistant' | 'status'
  preview: string
  avatar?: string
  model?: string
}
export const tabMinimapCacheAtom = atom<Map<string, TabMinimapItem[]>>(new Map())

// ===== 派生 Atoms =====

/** 按工作区过滤可见 tab：无归属（workspaceId 缺省）的 tab 各处可见 */
export function filterVisibleTabs(tabs: TabItem[], wsId: string | null): TabItem[] {
  if (wsId == null) return tabs
  return tabs.filter((t) => t.workspaceId == null || t.workspaceId === wsId)
}

/** 当前工作区可见的标签列表（tab 栏渲染 / 关闭邻位计算用此，而非全量 tabsAtom） */
export const visibleTabsAtom = atom<TabItem[]>((get) =>
  filterVisibleTabs(get(tabsAtom), get(currentAgentWorkspaceIdAtom)),
)

/** 当前活跃标签 */
export const activeTabAtom = atom<TabItem | null>((get) => {
  const activeId = get(activeTabIdAtom)
  if (!activeId) return null
  return get(tabsAtom).find((t) => t.id === activeId) ?? null
})

/** 标签是否在流式输出中（派生，从现有流式 atoms 计算） */
export const tabStreamingMapAtom = atom<Map<string, boolean>>((get) => {
  const tabs = get(tabsAtom)
  const agentRunning = get(agentRunningSessionIdsAtom)
  const map = new Map<string, boolean>()
  for (const tab of tabs) {
    map.set(tab.id, agentRunning.has(tab.sessionId))
  }
  return map
})

/** 标签页指示点状态 */
export const tabIndicatorMapAtom = atom<Map<string, SessionIndicatorStatus>>((get) => {
  const tabs = get(tabsAtom)
  const agentIndicator = get(agentSessionIndicatorMapAtom)
  const map = new Map<string, SessionIndicatorStatus>()
  for (const tab of tabs) {
    map.set(tab.id, agentIndicator.get(tab.sessionId) ?? 'idle')
  }
  return map
})

// ===== 操作函数 =====

/** 打开或聚焦标签页（如果已存在则聚焦，否则创建新标签） */
export function openTab(
  tabs: TabItem[],
  item: { type: TabType; sessionId: string; title: string; workspaceId?: string },
): { tabs: TabItem[]; activeTabId: string } {
  const existingTab = tabs.find((t) => t.sessionId === item.sessionId && t.type === item.type)

  if (existingTab) {
    // 已存在但缺归属、且本次 caller 提供时回填（旧持久化 tab / stale 列表场景自愈）
    if (existingTab.workspaceId == null && item.workspaceId != null) {
      return {
        tabs: tabs.map((t) =>
          t.id === existingTab.id ? { ...t, workspaceId: item.workspaceId } : t,
        ),
        activeTabId: existingTab.id,
      }
    }
    return { tabs, activeTabId: existingTab.id }
  }

  // 创建新标签
  const newTab: TabItem = {
    id: item.sessionId,
    type: item.type,
    sessionId: item.sessionId,
    title: item.title,
    ...(item.workspaceId != null ? { workspaceId: item.workspaceId } : {}),
  }

  return {
    tabs: [...tabs, newTab],
    activeTabId: newTab.id,
  }
}

/**
 * 关闭标签页。
 *
 * `visibleWorkspaceId` 提供时，关闭活跃 tab 后的邻位在该工作区**可见子集**内计算，
 * 避免激活被过滤隐藏的外部工作区 tab；无可见邻位 → activeTabId 置 null。
 * 缺省时退化为全量邻位（兼容无工作区上下文的调用方）。
 */
export function closeTab(
  tabs: TabItem[],
  activeTabId: string | null,
  tabId: string,
  visibleWorkspaceId?: string | null,
): { tabs: TabItem[]; activeTabId: string | null } {
  const tabIndex = tabs.findIndex((t) => t.id === tabId)
  if (tabIndex === -1) return { tabs, activeTabId }

  const newTabs = tabs.filter((t) => t.id !== tabId)

  // 如果关闭的是当前激活的标签，切换到相邻标签（在可见子集内取邻位）
  let newActiveTabId = activeTabId
  if (activeTabId === tabId) {
    const visibleBefore = visibleWorkspaceId !== undefined
      ? filterVisibleTabs(tabs, visibleWorkspaceId)
      : tabs
    const candidates = visibleBefore.filter((t) => t.id !== tabId)
    if (candidates.length > 0) {
      const closedVisibleIndex = visibleBefore.findIndex((t) => t.id === tabId)
      const nextIndex = Math.min(
        closedVisibleIndex === -1 ? candidates.length - 1 : closedVisibleIndex,
        candidates.length - 1,
      )
      newActiveTabId = candidates[nextIndex]!.id
    } else {
      newActiveTabId = null
    }
  }

  return { tabs: newTabs, activeTabId: newActiveTabId }
}

/**
 * 用 session meta 回填 tab 缺失的 workspaceId（自愈：openTab 时列表 stale 查不到的场景）。
 * 无任何变化时返回原数组引用，便于 store.sub 场景避免无谓更新。
 */
export function backfillTabWorkspaceIds(
  tabs: TabItem[],
  sessions: Pick<AgentSessionMeta, 'id' | 'workspaceId'>[],
): TabItem[] {
  let changed = false
  const next = tabs.map((t) => {
    if (t.workspaceId != null) return t
    const wsId = sessions.find((s) => s.id === t.sessionId)?.workspaceId
    if (wsId == null) return t
    changed = true
    return { ...t, workspaceId: wsId }
  })
  return changed ? next : tabs
}

/** 重排标签顺序 */
export function reorderTabs(
  tabs: TabItem[],
  fromIndex: number,
  toIndex: number,
): TabItem[] {
  if (fromIndex === toIndex) return tabs
  const newTabs = [...tabs]
  const [moved] = newTabs.splice(fromIndex, 1)
  newTabs.splice(toIndex, 0, moved!)
  return newTabs
}

/** 更新标签标题 */
export function updateTabTitle(
  tabs: TabItem[],
  sessionId: string,
  title: string,
): TabItem[] {
  return tabs.map((t) =>
    t.sessionId === sessionId ? { ...t, title } : t
  )
}

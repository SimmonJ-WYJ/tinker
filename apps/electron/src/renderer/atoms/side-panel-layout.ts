/**
 * 右侧面板比例布局 atoms
 * - 使用 atomWithStorage（localStorage）持久化，与 tab-atoms、channels-atoms 一致
 * - 关闭态与打开态各自记忆比例，用户拖拽后下次进入恢复
 */
import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { PaperRecord, WorkspacePaperEntry } from '@asci/shared'
import type { PreviewSiblings } from '@/components/preview/preview-sibling-helpers'
import { currentAgentSessionIdAtom, agentSidePanelOpenMapAtom } from './agent-atoms.ts'
import {
  rightPanelTabsBySessionAtom,
  rightPanelMaximizedAtom,
  currentActiveTabAtom,
  upsertTab,
  closeTab,
  isPreviewKind,
  kindOfTarget,
  titleOfTarget,
  tabIdOfTarget,
} from './right-panel-tabs.ts'

/** 文件预览目标（扩展名匹配 renderer） */
export interface FilePreviewTarget {
  kind: 'file'
  path: string
  ext: string        // 小写，不带点
  size: number       // 字节
}

/** 论文详情目标（PaperRecord 已在内存，无 IO） */
export interface PaperPreviewTarget {
  kind: 'paper'
  record: PaperRecord
}

/** 工作区论文条目预览目标（WorkspacePaperEntry，带状态字段） */
export interface PaperEntryPreviewTarget {
  kind: 'paper-entry'
  entry: WorkspacePaperEntry
}

export type PreviewTarget = FilePreviewTarget | PaperPreviewTarget | PaperEntryPreviewTarget

/**
 * 会话区 : 右侧面板 比例 — 已废弃,仅为向后兼容保留(localStorage 旧 key 不丢)。
 * Tab 化后右栏始终有内容,不再区分「关闭态/打开态」,统一用 sidePanelRatioAtom。
 */
export const sidePanelRatioClosedAtom = atomWithStorage<number>(
  'asci.sidePanel.closedRatio',
  0.22,
)

/**
 * 会话区 : 右侧面板 当前比例(唯一可拖拽尺寸)。
 * Tab 化前 key 是 `asci.sidePanel.openRatio`,这里复用同一 localStorage key 让老用户保留
 * 拖拽偏好;切换 Tab 不再触发宽度变化。
 */
export const sidePanelRatioAtom = atomWithStorage<number>(
  'asci.sidePanel.openRatio',
  0.45,
)
/** @deprecated 用 sidePanelRatioAtom;两者实为同一 atom,保留命名兼容旧代码 */
export const sidePanelRatioOpenAtom = sidePanelRatioAtom

/**
 * 现在是「writable-derived」桥接 atom：
 * - 读：从当前 session 的 active tab 派生 payload
 * - 写：透明转发到 rightPanelTabsBySessionAtom 的 upsertTab/closeTab
 *
 * 这层 shim 保持现有 25 处读取点 + 9 处写入点零改动，
 * 让后续 Task 可以逐文件迁移到 useOpenInRightPanel；
 * 全部迁完后可考虑收紧成 read-only（不在本计划范围）。
 */
export const currentPreviewAtom = atom<PreviewTarget | null, [PreviewTarget | null], void>(
  (get) => get(currentActiveTabAtom)?.payload ?? null,
  (get, set, next) => {
    const sessionId = get(currentAgentSessionIdAtom)
    if (!sessionId) return
    const tabsAtom = rightPanelTabsBySessionAtom(sessionId)
    const state = get(tabsAtom)
    if (next === null) {
      // 优先关「当前 active 的 preview tab」（多 file tab 时按 id 精确命中，不误关无关 tab）；
      // 当前 active 非 preview 时退化到关第一个 preview tab。
      // active tab 直接从手头的 state 派生，省去再读一次 currentActiveTabAtom。
      const active = state.tabs.find((t) => t.id === state.activeId)
      const previewTab =
        active && isPreviewKind(active.kind)
          ? active
          : state.tabs.find((t) => isPreviewKind(t.kind))
      if (previewTab) {
        set(tabsAtom, closeTab(state, previewTab.id))
      }
      return
    }
    set(agentSidePanelOpenMapAtom, (prev) => new Map(prev).set(sessionId, true))
    const id = tabIdOfTarget(next)
    const kind = kindOfTarget(next)
    const title = titleOfTarget(next)
    set(tabsAtom, upsertTab(state, id, kind, title, next))
  },
)

/** 右侧面板最小宽度（像素），用于防止比例过小导致 UI 挤压 */
export const SIDE_PANEL_MIN_PX = 260
/** 拖拽时右栏最大宽度比 (clamps Splitter 手动拖拽) */
export const SIDE_PANEL_MAX_RATIO = 0.60
/**
 * 程序触发的「全屏」右栏宽度比 (rightPanelMaximizedAtom 激活时使用)。
 * = 1.0：右栏占满整个内容区（对话区让出至 0、被覆盖），与 Codex 一致；再次点击按钮收回。
 */
export const SIDE_PANEL_MAXIMIZED_RATIO = 1.0

/**
 * 派生：当前应当使用的面板宽度比例。
 * Tab 化后切换 Tab 不再改变宽度,始终使用 sidePanelRatioAtom(全屏态例外)。
 */
export const effectiveRatioAtom = atom((get) => {
  if (get(rightPanelMaximizedAtom)) return SIDE_PANEL_MAXIMIZED_RATIO
  return get(sidePanelRatioAtom)
})

/** 兄弟文件列表（用于预览顶栏 ◀ ▶ 导航）；null 表示暂无兄弟信息 */
export const previewSiblingsAtom = atom<PreviewSiblings | null>(null)

/**
 * 论文预览兄弟列表（↑↓ 导航）—— 单一池，跨「已入库 entry」与「仅 record」全表流转。
 * 每个 item 必有 record，entry 可选；导航到某项时按 entry 有无分派 paper-entry / paper 预览。
 * 这样计数器分母 = 检索论文完整列表（不再把 entries / records 拆成两池导致 1/2 与 96 不符）。
 */
export interface PaperSiblingItem {
  record: PaperRecord
  entry?: WorkspacePaperEntry
}
export interface PaperPreviewSiblings {
  items: PaperSiblingItem[]
  currentIndex: number
}
export const previewPaperSiblingsAtom = atom<PaperPreviewSiblings | null>(null)

/** 预览区居中浮层提示（切换文件 / PDF 翻页 / 无更多等）；null 表示不展示 */
export const previewFlashMessageAtom = atom<{ text: string } | null>(null)

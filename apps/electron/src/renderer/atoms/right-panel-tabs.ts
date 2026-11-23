/**
 * 右栏 Tab 状态：每个 Agent session 一份独立 tabs 列表 + activeId。
 *
 * 不持久化（切会话清空通过 atomFamily 的 per-session 隔离自然实现）。
 *
 * Chrome 风累积模型（不主动清理，所有打开过的 tab 常驻直到手动关闭）：
 * - 默认 tab（session-files）恒在最前、**不可关闭**（会话文件面板必须常驻），
 *   但与其余 tab 一同参与横向滚动，无钉死。
 * - paper 详情按论文身份独立成 tab（`paper:<key>`，key 用 recordKey / entry.key，DOI 优先）：
 *   不同论文各自累积；同一篇论文的检索 record 与入库 entry 收敛到同一 tab（kind 随之更新）。
 * - file-preview 每个文件按 path 独立（`file-preview:<path>`），同文件再开则聚焦已有 tab。
 * 无「关闭全部」、无关闭历史：批量关闭只走右键单 tab 的「关闭其他 / 关闭右侧」（跳过默认 tab）。
 */
import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'
import { sanitizeText } from '@asci/shared'
import { recordKey } from '@/components/agent/session-papers-utils.ts'
import { currentAgentSessionIdAtom } from './agent-atoms.ts'
import type { PreviewTarget } from './side-panel-layout.ts'

export type TabKind =
  | 'session-files'
  | 'session-papers'
  | 'paper-detail'
  | 'paper-record'
  | 'file-preview'
  | 'research-gap-table'
  | 'quote-chat'

export interface RightTab {
  /** tab 唯一标识：默认 tab 为 kind 字符串；paper 为 `paper:<key>`；file-preview 为 `file-preview:<path>` */
  id: string
  kind: TabKind
  /** 默认 Tab 显示走 i18n（由 TabBar 渲染时翻译），此处留空串；preview Tab 存 payload 的展示标题 */
  title: string
  /** 只有 preview kind 持有 payload；默认 tab 永远 null */
  payload: PreviewTarget | null
}

export interface SessionTabsState {
  tabs: RightTab[]
  activeId: string | null
}

export const DEFAULT_TABS: ReadonlyArray<RightTab> = Object.freeze([
  { id: 'session-files', kind: 'session-files', title: '', payload: null },
])

/** 默认 tab 的 id 集合：恒常驻、不可关闭，批量关闭操作一律跳过 */
const DEFAULT_TAB_IDS: ReadonlySet<string> = new Set(DEFAULT_TABS.map((t) => t.id))

/** 该 tab 是否为不可关闭的默认 tab */
export function isDefaultTabId(id: string): boolean {
  return DEFAULT_TAB_IDS.has(id)
}

const PREVIEW_KINDS: ReadonlySet<TabKind> = new Set([
  'paper-detail',
  'paper-record',
  'file-preview',
])

export function isPreviewKind(kind: TabKind): boolean {
  return PREVIEW_KINDS.has(kind)
}

export function kindOfTarget(target: PreviewTarget): TabKind {
  switch (target.kind) {
    case 'file':
      return 'file-preview'
    case 'paper':
      return 'paper-detail'
    case 'paper-entry':
      return 'paper-record'
  }
}

/**
 * 从 target 派生 tab 唯一 id（tab 槽位身份）：
 * - file → `file-preview:<path>`，每个文件独立 tab
 * - paper / paper-entry → `paper:<key>`，**每篇论文独立 tab**（Chrome 风累积）。
 *   key 用 recordKey(record) / entry.key（均 DOI 优先、同源逻辑）：同一篇论文的检索 record
 *   与入库 entry 落到同一 id（kind 随之切换，内容路由按 kind 走）；不同论文各自成 tab。
 *   recordKey 取不到稳定标识时退化到 title+ts，保证每条至少不串台。
 */
export function tabIdOfTarget(target: PreviewTarget): string {
  switch (target.kind) {
    case 'file':
      return `file-preview:${target.path}`
    case 'paper': {
      const key = recordKey(target.record) ?? `t:${target.record.title}|${target.record.ts}`
      return `paper:${key}`
    }
    case 'paper-entry':
      return `paper:${target.entry.key}`
  }
}

/**
 * 从 target 派生可读的 tab 标题；论文标题剥 markup 标签（保内文）。
 * 标题缺失时返回空串：与默认 tab 同款，由 RightPanelTabBar 渲染时退化到 i18n
 * 文案（`rightPanel.tabs.paperDetail/paperRecord`），不在此处硬编码「Paper」。
 * paper-entry 退化到 `entry.key`（稳定标识，非展示文案，无需 i18n）。
 */
export function titleOfTarget(target: PreviewTarget): string {
  switch (target.kind) {
    case 'file':
      return target.displayName ?? target.path.split('/').pop() ?? target.path
    case 'paper':
      return sanitizeText(target.record.title)
    case 'paper-entry':
      return sanitizeText(target.entry.title) || target.entry.key
  }
}

/**
 * 不可变 upsert：同 id 替换 payload+title+kind；新 id 追加到末尾；总是激活该 tab。
 * paper / file-preview 的 id 含身份 → 不同对象各自新增、同一对象聚焦复用。
 */
export function upsertTab(
  state: SessionTabsState,
  id: string,
  kind: TabKind,
  title: string,
  payload: PreviewTarget | null,
): SessionTabsState {
  const existing = state.tabs.find((t) => t.id === id)
  if (existing) {
    // 同 id 复用槽位：连 kind 一起更新 —— paper tab 在 paper-detail / paper-record
    // 之间切换时，内容路由按 kind 走，必须刷新 kind 才能切到正确 renderer。
    return {
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, kind, title, payload } : t)),
      activeId: id,
    }
  }
  return {
    tabs: [...state.tabs, { id, kind, title, payload }],
    activeId: id,
  }
}

/**
 * 不可变「替换当前激活 tab 的内容」：把 activeId 指向的 tab 槽位**原地**换成新的
 * id/kind/title/payload（保持其在标签条中的位置），用于兄弟导航「原地切换、不新增 tab」。
 * - 若当前激活的是默认 tab 或无激活 tab，退化为 upsert（追加），避免误改默认槽位。
 * - 替换后若别处存在同 id 的旧 tab，去重（保留刚替换的槽位）。
 */
export function replaceActiveTab(
  state: SessionTabsState,
  id: string,
  kind: TabKind,
  title: string,
  payload: PreviewTarget | null,
): SessionTabsState {
  const activeIdx = state.activeId ? state.tabs.findIndex((t) => t.id === state.activeId) : -1
  const activeTab = activeIdx >= 0 ? state.tabs[activeIdx] : undefined
  // 激活的是默认 tab / 找不到激活 tab → 退化为追加（不动默认槽位）
  if (!activeTab || isDefaultTabId(activeTab.id)) {
    return upsertTab(state, id, kind, title, payload)
  }
  const replaced = state.tabs.map((t, i) => (i === activeIdx ? { id, kind, title, payload } : t))
  // 去重：移除别处与新 id 相同的旧 tab（保留刚替换的 activeIdx 槽位）
  const deduped = replaced.filter((t, i) => i === activeIdx || t.id !== id)
  return { tabs: deduped, activeId: id }
}

/** 关掉 active tab 后，挑选新的 activeId：优先相邻左，其次相邻右，都无则 null */
function pickActiveAfterRemoval(
  prevTabs: RightTab[],
  removedIdx: number,
  nextTabs: RightTab[],
): string | null {
  if (nextTabs.length === 0) return null
  if (removedIdx > 0) return nextTabs[removedIdx - 1]?.id ?? null
  return nextTabs[0]?.id ?? null
}

/**
 * 不可变 close：移除单个 tab；默认 tab 不可关闭（直接返回原状态）。
 * 若关的是 active，激活相邻左 tab（无则相邻右；都无则 null）。
 */
export function closeTab(state: SessionTabsState, id: string): SessionTabsState {
  if (isUnclosableTabId(id)) return state
  const idx = state.tabs.findIndex((t) => t.id === id)
  if (idx < 0) return state
  const next = state.tabs.filter((_, i) => i !== idx)
  const activeId =
    state.activeId === id ? pickActiveAfterRemoval(state.tabs, idx, next) : state.activeId
  return { tabs: next, activeId }
}

/**
 * 不可变「关闭其他」：仅保留默认 tab + 指定 id，其余全部关闭。激活保留下的指定 tab。
 * （右键单 tab 的精细批量操作，非顶部一键全清。）
 */
export function closeOtherTabs(state: SessionTabsState, keepId: string): SessionTabsState {
  const next = state.tabs.filter((t) => t.id === keepId || isUnclosableTabId(t.id))
  if (next.length === state.tabs.length) return state
  const activeId = next.some((t) => t.id === keepId) ? keepId : (next[0]?.id ?? null)
  return { tabs: next, activeId }
}

/**
 * 不可变「关闭右侧标签」：关闭目标 tab 右侧的全部 tab（默认 tab 恒在最前、不受影响）。
 * 若 active 落在被关掉的右侧 tab 上，回退到目标 tab。
 */
export function closeTabsToRight(state: SessionTabsState, id: string): SessionTabsState {
  const idx = state.tabs.findIndex((t) => t.id === id)
  if (idx < 0) return state
  const next = state.tabs.filter((t, i) => i <= idx || isUnclosableTabId(t.id))
  if (next.length === state.tabs.length) return state
  const activeId = next.some((t) => t.id === state.activeId) ? state.activeId : id
  return { tabs: next, activeId }
}

/** 每会话独立的 tabs atom；首次访问返回 DEFAULT_TABS（Files 激活） */
export const rightPanelTabsBySessionAtom = atomFamily((_sessionId: string) =>
  atom<SessionTabsState>({
    tabs: [...DEFAULT_TABS],
    activeId: 'session-files',
  }),
)

/**
 * 研究空白对照表 tab id 前缀（0.4 Epic 1）：**每次分析一张表、各自一个 tab**，
 * id = `research-gap:<tableId>`，标题 = AI 生成的 table.title，可手动关闭。
 * 关闭后由对话流内的结果卡片按 tableId 重新唤起（openResearchGapTab）。
 */
const RESEARCH_GAP_TAB_PREFIX = 'research-gap:'

/** 由 tableId 拼出 tab id */
export function researchGapTabId(tableId: string): string {
  return `${RESEARCH_GAP_TAB_PREFIX}${tableId}`
}

/** 若是研究空白 tab，取出其 tableId；否则 null */
export function researchGapTableIdOf(tabId: string): string | null {
  return tabId.startsWith(RESEARCH_GAP_TAB_PREFIX)
    ? tabId.slice(RESEARCH_GAP_TAB_PREFIX.length)
    : null
}

/** 打开（或聚焦）某张研究空白对照表 tab；title 为空时 TabBar 回退到默认「研究空白」 */
export function openResearchGapTab(
  state: SessionTabsState,
  tableId: string,
  title: string,
): SessionTabsState {
  return upsertTab(state, researchGapTabId(tableId), 'research-gap-table', title, null)
}

/**
 * 不可关闭的 tab：仅默认 tab（会话文件）。
 * 研究空白 tab 现在每次分析独立、可关闭（关了从对话内结果卡片点回来）。
 */
export function isUnclosableTabId(id: string): boolean {
  return isDefaultTabId(id)
}

/** 右栏全屏（70% 屏宽）开关；切换 session 会被 effect 重置 */
export const rightPanelMaximizedAtom = atom<boolean>(false)

/** 当前会话的 tabs state（null 表示无 session） */
export const currentSessionTabsAtom = atom<SessionTabsState | null>((get) => {
  const sid = get(currentAgentSessionIdAtom)
  if (!sid) return null
  return get(rightPanelTabsBySessionAtom(sid))
})

/** 当前会话当前激活的 tab（null 表示无 tab 或无 session） */
export const currentActiveTabAtom = atom<RightTab | null>((get) => {
  const state = get(currentSessionTabsAtom)
  if (!state || !state.activeId) return null
  return state.tabs.find((t) => t.id === state.activeId) ?? null
})

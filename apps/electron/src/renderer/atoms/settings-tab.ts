/**
 * Settings Tab Atom - 设置标签页状态
 *
 * 管理设置面板中当前激活的标签页：
 * - profile: 个人资料（新增，Stage 1 仅占位）
 * - general: 通用设置
 * - channels: 渠道配置（模型与渠道）
 * - zotero: Zotero 集成
 * - proxy: 网络代理
 * - mcp: MCP 服务器（全局列表）
 * - datacollection: 数据采集（spec §6.5 骨架占位 — PostHog / 自进化埋点真功能在 0.3 §三 / §三-A 落地）
 * - shortcuts: 快捷键
 * - archived: 已归档（导航隐藏，仅作隐藏路由保留以兼容 onboarding）
 * - about: 关于
 *
 * `null` 哨兵语义：未被显式 setter 设置过。
 * 由 SettingsDialog 在打开时（open=true 且 tab=null）从 `settingsLastTabAtom` 恢复；
 * 在关闭时重置回 null。外部调用方（LeftSidebar / SpotlightOverlay / ModelSelector）
 * 显式 setSettingsTab(x) 后再 setSettingsOpen(true) —— tab 非 null，恢复逻辑不触发。
 */

import { atom } from 'jotai'

export type SettingsTab =
  | 'profile'
  | 'general'
  | 'channels'
  | 'proxy'
  | 'about'
  | 'mcp'
  | 'datacollection'
  | 'shortcuts'
  | 'archived'
  | 'zotero'

/** 合法 tab 集合（运行期校验旧 localStorage 残留值，如 0.2 的 'agent'/'config'） */
const VALID_SETTINGS_TABS: ReadonlySet<string> = new Set<SettingsTab>([
  'profile',
  'general',
  'channels',
  'proxy',
  'about',
  'mcp',
  'datacollection',
  'shortcuts',
  'archived',
  'zotero',
])

/** 把任意字符串收敛为合法 SettingsTab；陌生值（如旧版已删 tab）回退 'profile' */
export function coerceSettingsTab(value: string | null | undefined): SettingsTab {
  return value && VALID_SETTINGS_TABS.has(value) ? (value as SettingsTab) : 'profile'
}

/** 当前设置标签页；null = 未显式设置（首次打开走 lastTab 恢复） */
export const settingsTabAtom = atom<SettingsTab | null>(null)

/** 设置浮窗是否打开 */
export const settingsOpenAtom = atom(false)

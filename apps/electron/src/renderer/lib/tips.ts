/**
 * Tips 管理模块 — 平台感知的使用技巧
 *
 * 区分 macOS / Windows 平台，提供随机轮换的小贴士。
 * 文案走 i18n（onboarding.tips.*），此处仅保存 i18n key。
 */

export type Platform = 'mac' | 'windows'

export interface Tip {
  id: string
  /** i18n key under onboarding.tips */
  textKey: string
  /** 适用平台，'all' 表示通用 */
  platform: Platform | 'all'
}

/** 检测当前平台 */
export function getPlatform(): Platform {
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')) {
    return 'mac'
  }
  return 'windows'
}

/** 所有 Tips 数据 */
export const TIPS: Tip[] = [
  // macOS 快捷键
  { id: 'mac-shortcut-new', textKey: 'macShortcutNew', platform: 'mac' },
  { id: 'mac-shortcut-search', textKey: 'macShortcutSearch', platform: 'mac' },
  { id: 'mac-shortcut-settings', textKey: 'macShortcutSettings', platform: 'mac' },
  { id: 'mac-shortcut-sidebar', textKey: 'macShortcutSidebar', platform: 'mac' },
  { id: 'mac-shortcut-mode', textKey: 'macShortcutMode', platform: 'mac' },
  { id: 'mac-shortcut-focus', textKey: 'macShortcutFocus', platform: 'mac' },
  { id: 'mac-shortcut-clear', textKey: 'macShortcutClear', platform: 'mac' },
  { id: 'mac-shortcut-stop', textKey: 'macShortcutStop', platform: 'mac' },
  { id: 'mac-shortcut-close', textKey: 'macShortcutClose', platform: 'mac' },
  { id: 'mac-shortcut-zoom', textKey: 'macShortcutZoom', platform: 'mac' },

  // Windows 快捷键
  { id: 'win-shortcut-new', textKey: 'winShortcutNew', platform: 'windows' },
  { id: 'win-shortcut-search', textKey: 'winShortcutSearch', platform: 'windows' },
  { id: 'win-shortcut-settings', textKey: 'winShortcutSettings', platform: 'windows' },
  { id: 'win-shortcut-sidebar', textKey: 'winShortcutSidebar', platform: 'windows' },
  { id: 'win-shortcut-mode', textKey: 'winShortcutMode', platform: 'windows' },
  { id: 'win-shortcut-focus', textKey: 'winShortcutFocus', platform: 'windows' },
  { id: 'win-shortcut-clear', textKey: 'winShortcutClear', platform: 'windows' },
  { id: 'win-shortcut-stop', textKey: 'winShortcutStop', platform: 'windows' },
  { id: 'win-shortcut-close', textKey: 'winShortcutClose', platform: 'windows' },
  { id: 'win-shortcut-zoom', textKey: 'winShortcutZoom', platform: 'windows' },

  // 通用使用技巧
  { id: 'tip-agent-file', textKey: 'tipAgentFile', platform: 'all' },
  { id: 'tip-attachment', textKey: 'tipAttachment', platform: 'all' },
  { id: 'tip-shortcuts-custom', textKey: 'tipShortcutsCustom', platform: 'all' },

  // Agent 任务引导：文献检索 / 综述 / 对比 / 总结
  { id: 'task-search', textKey: 'taskSearch', platform: 'all' },
  { id: 'task-review', textKey: 'taskReview', platform: 'all' },
  { id: 'task-compare', textKey: 'taskCompare', platform: 'all' },
  { id: 'task-summarize', textKey: 'taskSummarize', platform: 'all' },
  { id: 'task-zotero', textKey: 'taskZotero', platform: 'all' },
  { id: 'task-outline', textKey: 'taskOutline', platform: 'all' },
]

/** 获取适用于当前平台的随机 Tip */
export function getRandomTip(platform: Platform): Tip {
  const filtered = TIPS.filter((t) => t.platform === 'all' || t.platform === platform)
  const index = Math.floor(Math.random() * filtered.length)
  return filtered[index] ?? filtered[0]!
}

/** 获取适用于当前平台的所有 Tip（已 shuffle，用于轮播展示） */
export function getShuffledTips(platform: Platform): Tip[] {
  const filtered = TIPS.filter((t) => t.platform === 'all' || t.platform === platform)
  const shuffled = [...filtered]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
  }
  return shuffled
}

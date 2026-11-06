/**
 * Settings Last Tab Atom - 最后一次打开的设置 tab
 *
 * 纯 UI 状态（localStorage），与 ~/.asci/settings.json 独立，不进主进程持久化。
 * SettingsDialog 打开时若 settingsTabAtom === null（未被外部 setter 显式设过），
 * 从此 atom 恢复 tab；SettingsPanel 用户切 tab 时同步写入。
 */

import { atomWithStorage } from 'jotai/utils'
import type { SettingsTab } from './settings-tab'

export const settingsLastTabAtom = atomWithStorage<SettingsTab>(
  'asci.settings.lastTab',
  'profile',
)

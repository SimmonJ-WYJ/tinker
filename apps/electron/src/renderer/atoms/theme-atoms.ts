/**
 * 应用主题状态管理
 *
 * 主进程是 isDark 的唯一真相源：renderer 仅读 + 写 settings.theme，
 * 由主进程解析（system 模式叠加 nativeTheme.shouldUseDarkColors）并广播 {mode, isDark}。
 * renderer 的 themeAtom / isDarkAtom 都通过 onThemeChanged 与主进程同步。
 */

import { atom } from 'jotai'
import type { AppTheme } from '@/types/settings'

/** 用户偏好主题模式（默认 'system'，由 ThemeInitializer 启动期从 preload 拉取覆盖） */
export const themeAtom = atom<AppTheme>('system')

/** 当前生效的 dark 状态（system 模式会随 OS 偏好变化） */
export const isDarkAtom = atom<boolean>(false)

/** 切换 <html> 根节点的 .dark class（Tailwind darkMode: 'class' 触发器） */
export function applyDarkClass(isDark: boolean): void {
  document.documentElement.classList.toggle('dark', isDark)
}

/**
 * 从 preload 同步读取已解析的主题并写入 atom + 应用 .dark class。
 * 启动期由 ThemeInitializer 调用一次；preload 已通过 sendSync 提前抓取，无网络开销。
 */
export function initializeTheme(
  setTheme: (m: AppTheme) => void,
  setIsDark: (b: boolean) => void
): void {
  try {
    const resolved = window.electronAPI.resolveTheme()
    setTheme(resolved.mode)
    setIsDark(resolved.isDark)
    applyDarkClass(resolved.isDark)
  } catch (error) {
    console.error('[主题] 初始化失败:', error)
  }
}

/**
 * 切换并持久化主题偏好。
 * 不在此处本地 apply .dark class —— 主进程持久化后会通过 theme:changed 推回权威 {mode, isDark}，
 * ThemeInitializer 的订阅会统一更新 atom + class，避免 optimistic 漂移。
 */
export async function updateTheme(mode: AppTheme): Promise<void> {
  try {
    await window.electronAPI.updateSettings({ theme: mode })
  } catch (error) {
    console.error('[主题] 更新设置失败:', error)
  }
}

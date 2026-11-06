/**
 * 主题解析服务
 *
 * 主进程是 isDark 的唯一真相源：
 * - mode === 'system' → 取 nativeTheme.shouldUseDarkColors
 * - mode === 'light' / 'dark' → 直接映射
 *
 * 系统偏好变化时只在 mode === 'system' 才广播，避免 light/dark 用户被 OS 切换误伤。
 */

import { nativeTheme } from 'electron'
import { getSettings } from './settings-service'
import type { AppTheme, ResolvedTheme } from '../../types'

/** 解析当前生效主题（用户偏好 + OS 偏好叠加） */
export function resolveTheme(): ResolvedTheme {
  const mode: AppTheme = getSettings().theme ?? 'system'
  const isDark =
    mode === 'system' ? nativeTheme.shouldUseDarkColors : mode === 'dark'
  return { mode, isDark }
}

/**
 * 注册 nativeTheme 监听器：OS 主题变化时，若用户处于 system 模式则广播最新状态。
 * 调用方负责传入 broadcast 函数（见 ipc.ts 内的多窗口广播实现）。
 */
export function registerNativeThemeListener(
  broadcast: (state: ResolvedTheme) => void
): void {
  nativeTheme.on('updated', () => {
    const resolved = resolveTheme()
    if (resolved.mode === 'system') {
      broadcast(resolved)
    }
  })
}

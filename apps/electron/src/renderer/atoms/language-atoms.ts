/**
 * 应用界面语言状态管理
 *
 * 默认 English，不做系统语言检测。
 * 偏好读写来自 ~/.asci/settings.json，通过既有 settings IPC 通道；
 * 渲染端的 i18next 实例由 setAppLanguage() 同步驱动重渲染。
 */

import { atom } from 'jotai'
import type { AppLocale } from '@/types/settings'
import { DEFAULT_LOCALE } from '@/locales'
import { setAppLanguage } from '@/lib/i18n'

/** 当前界面语言（初始 'en'，挂载后由 LanguageInitializer 从设置文件读取覆盖） */
export const languageAtom = atom<AppLocale>(DEFAULT_LOCALE)

/**
 * 从主进程加载语言偏好
 */
export async function initializeLanguage(
  setLanguage: (lng: AppLocale) => void
): Promise<void> {
  try {
    const settings = await window.electronAPI.getSettings()
    const lng: AppLocale = settings.language ?? DEFAULT_LOCALE
    setLanguage(lng)
    await setAppLanguage(lng)
  } catch (error) {
    console.error('[语言] 初始化失败:', error)
  }
}

/**
 * 切换并持久化语言偏好
 */
export async function updateLanguage(lng: AppLocale): Promise<void> {
  try {
    await window.electronAPI.updateSettings({ language: lng })
    await setAppLanguage(lng)
  } catch (error) {
    console.error('[语言] 更新设置失败:', error)
  }
}

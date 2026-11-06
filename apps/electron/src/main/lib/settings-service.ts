/**
 * 应用设置服务
 *
 * 读写 ~/.asci/settings.json。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { getSettingsPath } from './config-paths'
import type { AppSettings } from '../../types'

/**
 * 判定当前是否为「全新安装」首次启动
 *
 * 信号：settings.json 在磁盘上不存在 ⇔ 用户从未写入过任何设置。
 * 用于区分「首次启动」(应自动唤起 onboarding spotlight) 与「老用户升级」
 * (settings.json 已存在但缺少 onboardingSpotlight 字段，不应强制重走引导)。
 */
export function isFreshInstall(): boolean {
  return !existsSync(getSettingsPath())
}

/**
 * 获取应用设置
 *
 * 如果文件不存在，返回默认设置。
 */
export function getSettings(): AppSettings {
  const filePath = getSettingsPath()

  if (!existsSync(filePath)) {
    return {
      notificationsEnabled: true,
    }
  }

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as Partial<AppSettings>
    return {
      ...data,
      notificationsEnabled: data.notificationsEnabled ?? true,
    }
  } catch (error) {
    console.error('[设置] 读取失败:', error)
    return {
      notificationsEnabled: true,
    }
  }
}

/**
 * 更新应用设置
 *
 * 合并更新字段并写入文件。
 */
export function updateSettings(updates: Partial<AppSettings>): AppSettings {
  const current = getSettings()
  const updated: AppSettings = {
    ...current,
    ...updates,
  }

  const filePath = getSettingsPath()

  try {
    writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf-8')
    console.log('[设置] 已更新:', JSON.stringify(updated))
  } catch (error) {
    console.error('[设置] 写入失败:', error)
    throw new Error('写入应用设置失败')
  }

  return updated
}

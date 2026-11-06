/**
 * 应用设置 / 主题 / 遥测 / 用户档案 / 数据导出 / 代理 IPC 处理器
 *
 * 汇集设置读写与语言/主题联动、主题广播与系统主题监听、ADR-011 遥测汇集、
 * 用户档案 CRUD、一键数据导出（issue #419）、代理配置与系统代理检测相关的 IPC 通道。
 */

import { shell, dialog, BrowserWindow, app, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import {
  PROXY_IPC_CHANNELS,
  DATA_EXPORT_IPC_CHANNELS,
  dayjs,
  TELEMETRY_IPC_CHANNELS,
  TELEMETRY_EVENTS,
} from '@asci/shared'
import type { ExportMyDataResult, TelemetryTrackRequest, TelemetryCaptureSignalRequest, TelemetryConsentState } from '@asci/shared'
import { exportMyData, ExportValidationError } from '../lib/objects/export-service.ts'
import { telemetryService } from '../lib/telemetry/telemetry-service.ts'
import { isRealSendAllowed } from '../lib/dev-runtime.ts'
import { t as tMain, setLanguage as setMainLanguage } from '../lib/i18n-main'
import { USER_PROFILE_IPC_CHANNELS, SETTINGS_IPC_CHANNELS, THEME_IPC_CHANNELS } from '../../types'
import type { UserProfile, AppSettings, ResolvedTheme } from '../../types'
import { resolveTheme, registerNativeThemeListener } from '../lib/theme-service'
import type { ProxyConfig, SystemProxyDetectResult } from '@asci/shared'
import { getUserProfile, updateUserProfile } from '../lib/user-profile-service'
import { getSettings, updateSettings } from '../lib/settings-service'
import { getProxySettings, saveProxySettings } from '../lib/proxy-settings-service'
import { detectSystemProxy } from '../lib/system-proxy-detector'
import { getUserProfilePath } from '../lib/config-paths'
import { getDb as getObjectsDb } from '../lib/objects/object-store.ts'

// 主题广播辅助函数：向所有存活窗口推送最新解析的 {mode, isDark}
const broadcastTheme = (state: ResolvedTheme): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(THEME_IPC_CHANNELS.CHANGED, state)
  }
}

/** 注册应用设置 / 主题 / 遥测 / 用户档案 / 数据导出 / 代理 IPC 处理器 */
export function registerSettingsIpc(): void {
  // ===== 用户档案相关 =====

  // 获取用户档案
  ipcMain.handle(
    USER_PROFILE_IPC_CHANNELS.GET,
    async (): Promise<UserProfile> => {
      return getUserProfile()
    }
  )

  // 更新用户档案
  ipcMain.handle(
    USER_PROFILE_IPC_CHANNELS.UPDATE,
    async (_, updates: Partial<UserProfile>): Promise<UserProfile> => {
      // profile_created 埋点（#420 登录落地前的占位归属事件）：
      // 首次创建 = user-profile.json 在写入前不存在。在 handler 层发而非
      // service 内，保持 user-profile-service 对 telemetry 解耦。
      const isFirstCreation = !existsSync(getUserProfilePath())
      const result = updateUserProfile(updates)
      if (isFirstCreation) {
        telemetryService.track({ event: TELEMETRY_EVENTS.PROFILE_CREATED, props: {} })
      }
      return result
    }
  )

  // ===== 数据导出（DO-2，issue #419）=====

  // 一键导出全部本地研究数据为 zip 导出包：Save As 选路径 → 全量读取 + ajv 校验 →
  // 打 zip → 在访达/资源管理器中定位。校验失败中止不落盘（spec D5）。
  ipcMain.handle(
    DATA_EXPORT_IPC_CHANNELS.EXPORT_MY_DATA,
    async (event): Promise<ExportMyDataResult> => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const date = dayjs().format('YYYY-MM-DD')
      const saveResult = await dialog.showSaveDialog(win ?? BrowserWindow.getFocusedWindow()!, {
        defaultPath: `asci-export-${date}.zip`,
        filters: [{ name: tMain('chrome.dialog.zipFilter'), extensions: ['zip'] }],
      })
      if (saveResult.canceled || !saveResult.filePath) return { status: 'canceled' }

      try {
        const output = exportMyData(getObjectsDb(), {
          outPath: saveResult.filePath,
          appVersion: app.getVersion(),
        })
        shell.showItemInFolder(saveResult.filePath)
        return { status: 'ok', filePath: saveResult.filePath, objectCount: output.objectCount }
      } catch (error) {
        console.error('[数据导出] 失败:', error)
        if (error instanceof ExportValidationError) {
          return {
            status: 'error',
            message: tMain('errors.dataExport.validationFailed', {
              dataFile: error.dataFile,
              objectId: error.objectId,
            }),
          }
        }
        return {
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        }
      }
    }
  )

  // ===== 应用设置相关 =====

  // 获取应用设置
  ipcMain.handle(
    SETTINGS_IPC_CHANNELS.GET,
    async (): Promise<AppSettings> => {
      return getSettings()
    }
  )

  // 更新应用设置
  ipcMain.handle(
    SETTINGS_IPC_CHANNELS.UPDATE,
    async (_, updates: Partial<AppSettings>): Promise<AppSettings> => {
      const result = await updateSettings(updates)
      // 语言变更时同步主进程 i18n（驱动 menu/tray 重建，由 onLanguageChange 监听）
      if (updates.language === 'en' || updates.language === 'zh') {
        setMainLanguage(updates.language)
      }
      // 主题变更时广播最新解析状态，所有窗口同步切换 .dark class
      if (updates.theme !== undefined) {
        broadcastTheme(resolveTheme())
      }
      // 遥测 consent 或 dev 上报开关变更时重算生效闸门（数据采集 tab；dev 开关即时生效）
      if (updates.telemetryConsent !== undefined || updates.telemetryDevForceSend !== undefined) {
        telemetryService.refreshConsent()
      }
      return result
    }
  )

  // 同步更新应用设置（用于 beforeunload 场景）
  ipcMain.on(
    SETTINGS_IPC_CHANNELS.UPDATE_SYNC,
    (event, updates: Partial<AppSettings>) => {
      try {
        updateSettings(updates)
        if (updates.language === 'en' || updates.language === 'zh') {
          setMainLanguage(updates.language)
        }
        if (updates.theme !== undefined) {
          broadcastTheme(resolveTheme())
        }
        event.returnValue = true
      } catch {
        event.returnValue = false
      }
    }
  )

  // ===== 遥测（ADR-011 主进程统一汇集）=====

  // 行为事件投递（renderer 显式埋点 → consent 闸门 / 脱敏 / 上报都在 service 内）
  ipcMain.handle(
    TELEMETRY_IPC_CHANNELS.TRACK,
    async (_, request: TelemetryTrackRequest): Promise<void> => {
      telemetryService.track(request)
    }
  )

  // 自进化隐式反馈信号投递（ts/deviceId 由 service 注入）
  ipcMain.handle(
    TELEMETRY_IPC_CHANNELS.CAPTURE_SIGNAL,
    async (_, request: TelemetryCaptureSignalRequest): Promise<void> => {
      telemetryService.captureSignal(request as unknown as Record<string, unknown>)
    }
  )

  // consent 运行时状态查询（数据采集 tab 展示地域默认与生效开关）
  ipcMain.handle(
    TELEMETRY_IPC_CHANNELS.GET_CONSENT_STATE,
    async (): Promise<TelemetryConsentState> => {
      return telemetryService.getConsentState()
    }
  )

  // dev 是否允许真实上报（env || dev 开关）——preload 启动期 sendSync，供 renderer Sentry 门控
  ipcMain.on(TELEMETRY_IPC_CHANNELS.REAL_SEND_ALLOWED, (event) => {
    event.returnValue = isRealSendAllowed()
  })

  // ===== 主题 =====

  // 同步返回当前解析的主题（preload 启动期调用，避免首帧白闪）
  ipcMain.on(THEME_IPC_CHANNELS.RESOLVE, (event) => {
    event.returnValue = resolveTheme()
  })

  // OS 系统主题变化时（仅 mode === 'system' 才会触发广播）
  registerNativeThemeListener((state) => broadcastTheme(state))

  // ===== 代理配置相关 =====

  // 获取代理配置
  ipcMain.handle(
    PROXY_IPC_CHANNELS.GET_SETTINGS,
    async (): Promise<ProxyConfig> => {
      return getProxySettings()
    }
  )

  // 更新代理配置
  ipcMain.handle(
    PROXY_IPC_CHANNELS.UPDATE_SETTINGS,
    async (_, config: ProxyConfig): Promise<void> => {
      await saveProxySettings(config)
    }
  )

  // 检测系统代理
  ipcMain.handle(
    PROXY_IPC_CHANNELS.DETECT_SYSTEM,
    async (): Promise<SystemProxyDetectResult> => {
      return detectSystemProxy()
    }
  )
}

/**
 * IPC 处理器编排模块
 *
 * 主进程 IPC 处理器的统一注册入口。各领域 handler 已按域拆分到 `ipc/` 目录下的
 * `register<Domain>Ipc()` 函数，本文件只负责按序调用它们完成注册，自身不再内联业务逻辑。
 */

import { ipcMain, app } from 'electron'
import { AUTH_CHANNELS, OAUTH_CHANNELS } from '@asci/shared'
import type { AuthService } from './lib/auth-service.ts'
import { scanLocalData } from './lib/auth-upgrade.ts'
import { getConfigDir } from './lib/config-paths'
import { registerUpdaterIpc } from './lib/updater/updater-ipc'
import { registerChannelIpc } from './ipc/channel'
import { registerAttachmentIpc } from './ipc/attachment'
import { registerSettingsIpc } from './ipc/settings'
import { registerSpotlightIpc } from './ipc/spotlight'
import { registerAgentSessionIpc } from './ipc/agent-session'
import { registerPapersIpc } from './ipc/papers'
import { registerFileOpsIpc } from './ipc/file-ops'
import { registerZoteroIpc } from './ipc/zotero'
import { registerCitationGraphIpc } from './ipc/citation-graph'
import { registerMiscIpc } from './ipc/misc'

/**
 * 注册 IPC 处理器
 *
 * 按域顺序注册所有 IPC handler：runtime/git/external-link 等杂项、渠道、附件、
 * 设置/主题/遥测/用户档案/数据导出/代理、Spotlight 引导、Agent 会话/工作区/能力/权限、
 * 论文/笔记/综述/证据集、文件系统操作与预览、Zotero 集成、引用图谱、自动更新。
 */
export function registerIpcHandlers(): void {
  console.log('[IPC] 正在注册 IPC 处理器...')

  registerMiscIpc()
  registerChannelIpc()
  registerAttachmentIpc()
  registerSettingsIpc()
  registerSpotlightIpc()
  registerAgentSessionIpc()
  registerPapersIpc()
  registerFileOpsIpc()
  registerZoteroIpc()
  registerCitationGraphIpc()

  console.log('[IPC] IPC 处理器注册完成')

  // 注册更新 IPC 处理器
  registerUpdaterIpc()
}

// ─── Auth IPC 注册（独立函数，由 main/index.ts 在 AuthService 构造后调用） ───

/**
 * 注册 14 条 AUTH + 2 条 OAUTH IPC 处理器 - spec §五
 *
 * 必须在 AuthService 构造完成后调用（依赖 svc 实例）。
 * 仅 LOGIN_ENABLED（默认开，dev:skip-login 关）时由 main/index.ts 调用 → 关时通道不注册。
 */
export function registerAuthIpc(svc: AuthService): void {
  ipcMain.handle(AUTH_CHANNELS.LOGIN, (_e, req) => svc.login(req))
  ipcMain.handle(AUTH_CHANNELS.REGISTER, (_e, req) => svc.register(req))
  ipcMain.handle(AUTH_CHANNELS.LOGOUT, () => svc.logout())
  ipcMain.handle(AUTH_CHANNELS.GET_CURRENT_USER, () => svc.getCurrentUser())
  ipcMain.handle(AUTH_CHANNELS.REFRESH, () => svc.refresh())
  ipcMain.handle(AUTH_CHANNELS.REQUEST_EMAIL_VERIFY, (_e, req) => svc.requestEmailVerify(req))
  ipcMain.handle(AUTH_CHANNELS.CONFIRM_EMAIL_VERIFY, (_e, req) => svc.confirmEmailVerify(req))
  ipcMain.handle(AUTH_CHANNELS.REQUEST_PASSWORD_RESET, (_e, req) => svc.requestPasswordReset(req))
  ipcMain.handle(AUTH_CHANNELS.CONFIRM_PASSWORD_RESET, (_e, req) => svc.confirmPasswordReset(req))
  ipcMain.handle(AUTH_CHANNELS.UPDATE_PROFILE, (_e, req) => svc.updateProfile(req))
  ipcMain.handle(AUTH_CHANNELS.DELETE_ACCOUNT, () => svc.deleteAccount())
  ipcMain.handle(AUTH_CHANNELS.VERIFY_CONNECTION, () => svc.verifyServerConnection())
  // dev-only：取 access token 原文供手动调试；生产（已打包）恒拒，防 token 外泄
  ipcMain.handle(AUTH_CHANNELS.GET_ACCESS_TOKEN_DEV, () =>
    app.isPackaged
      ? Promise.resolve({ ok: false, error: { code: 'unknown', message: 'dev only' } })
      : svc.getAccessTokenForDev(),
  )
  ipcMain.handle(AUTH_CHANNELS.GET_SESSION_META, () => svc.getSessionMeta())
  ipcMain.handle(AUTH_CHANNELS.MARK_RENDERER_READY, () => {
    svc.markRendererReady()
    return { ok: true, value: undefined }
  })
  ipcMain.handle(AUTH_CHANNELS.SCAN_LOCAL_DATA, async () => {
    return { ok: true, value: await scanLocalData(getConfigDir()) }
  })

  ipcMain.handle(OAUTH_CHANNELS.START, (_e, req) => svc.oauthStart(req))
  ipcMain.handle(OAUTH_CHANNELS.CANCEL, (_e, req) => svc.oauthCancel(req))
}

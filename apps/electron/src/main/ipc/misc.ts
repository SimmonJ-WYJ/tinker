/**
 * 杂项 IPC 处理器
 *
 * 汇集运行时状态 / Git 仓库状态 / 打开外部链接、GitHub Release、快速任务窗口、
 * Runtime Provisioner 状态、能力包管理、Paper Search MCP 集成相关的 IPC 通道。
 */

import { shell, ipcMain } from 'electron'
import {
  IPC_CHANNELS,
  GITHUB_RELEASE_IPC_CHANNELS,
  RUNTIME_PROVISIONER_IPC_CHANNELS,
  PAPER_SEARCH_IPC_CHANNELS,
  CAPABILITY_PACK_IPC_CHANNELS,
} from '@asci/shared'
import type {
  CapabilityPackListResponse,
  RuntimeStatus,
  GitRepoStatus,
  GitHubRelease,
  GitHubReleaseListOptions,
} from '@asci/shared'
import { QUICK_TASK_IPC_CHANNELS } from '../../types'
import type { QuickTaskSubmitInput } from '../../types'
import { getRuntimeStatus, getGitRepoStatus } from '../lib/runtime-init'
import { getRuntimeProvisioner } from '../lib/runtime/runtime-provisioner.ts'
import { listCapabilityPacks } from '../lib/capability-pack-service.ts'
import {
  getLatestRelease,
  listReleases as listGitHubReleases,
  getReleaseByTag,
} from '../lib/github-release-service'

/** 注册杂项 IPC 处理器 */
export function registerMiscIpc(): void {
  // ===== 运行时相关 =====

  // 获取运行时状态
  ipcMain.handle(
    IPC_CHANNELS.GET_RUNTIME_STATUS,
    async (): Promise<RuntimeStatus | null> => {
      return getRuntimeStatus()
    }
  )

  // 获取指定目录的 Git 仓库状态
  ipcMain.handle(
    IPC_CHANNELS.GET_GIT_REPO_STATUS,
    async (_, dirPath: string): Promise<GitRepoStatus | null> => {
      if (!dirPath || typeof dirPath !== 'string') {
        console.warn('[IPC] git:get-repo-status 收到无效的目录路径')
        return null
      }

      return getGitRepoStatus(dirPath)
    }
  )

  // 在系统默认浏览器中打开外部链接
  ipcMain.handle(
    IPC_CHANNELS.OPEN_EXTERNAL,
    async (_, url: string): Promise<void> => {
      if (!url || typeof url !== 'string') {
        console.warn('[IPC] shell:open-external 收到无效的 URL')
        return
      }
      // 仅允许 http/https 协议，防止安全风险
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        console.warn('[IPC] shell:open-external 仅支持 http/https 协议:', url)
        return
      }
      await shell.openExternal(url)
    }
  )

  // ===== GitHub Release =====

  // 获取最新 Release
  ipcMain.handle(
    GITHUB_RELEASE_IPC_CHANNELS.GET_LATEST_RELEASE,
    async (): Promise<GitHubRelease | null> => {
      return getLatestRelease()
    }
  )

  // 获取 Release 列表
  ipcMain.handle(
    GITHUB_RELEASE_IPC_CHANNELS.LIST_RELEASES,
    async (_, options?: GitHubReleaseListOptions): Promise<GitHubRelease[]> => {
      return listGitHubReleases(options)
    }
  )

  // 获取指定版本的 Release
  ipcMain.handle(
    GITHUB_RELEASE_IPC_CHANNELS.GET_RELEASE_BY_TAG,
    async (_, tag: string): Promise<GitHubRelease | null> => {
      return getReleaseByTag(tag)
    }
  )

  // ===== 快速任务窗口 =====

  // 提交快速任务 → 隐藏窗口 + 转发到主窗口（由渲染进程创建会话并发送消息）
  ipcMain.handle(
    QUICK_TASK_IPC_CHANNELS.SUBMIT,
    async (_, input: QuickTaskSubmitInput): Promise<void> => {
      const { hideQuickTaskWindow } = await import('../lib/quick-task-window')
      const { getMainWindow } = await import('../index')
      hideQuickTaskWindow()

      const mainWin = getMainWindow()
      if (mainWin && !mainWin.isDestroyed()) {
        // 转发到主窗口渲染进程，由 GlobalShortcuts 创建会话并触发发送
        mainWin.webContents.send('quick-task:open-session', {
          mode: input.mode,
          text: input.text,
          files: input.files,
        })
        mainWin.show()
        mainWin.focus()
      }
    }
  )

  // 隐藏快速任务窗口
  ipcMain.handle(
    QUICK_TASK_IPC_CHANNELS.HIDE,
    async (): Promise<void> => {
      const { hideQuickTaskWindow } = await import('../lib/quick-task-window')
      hideQuickTaskWindow()
    }
  )

  // 重新注册全局快捷键（设置中修改快捷键后调用）
  ipcMain.handle(
    QUICK_TASK_IPC_CHANNELS.REREGISTER_GLOBAL_SHORTCUTS,
    async (): Promise<Record<string, boolean>> => {
      const { reregisterAllGlobalShortcuts } = await import('../lib/global-shortcut-service')
      return reregisterAllGlobalShortcuts()
    }
  )

  // ===== Paper Search MCP 集成 =====
  // paper-search 与 zotero/ocr/asr 一样是内建 MCP，无独立 UI 开关：uv 可用即自动启用
  // （commit ef28c94）。下方 IPC 仅暴露运行时可用性查询与 API Key 等 env 配置。

  ipcMain.handle(PAPER_SEARCH_IPC_CHANNELS.GET_STATUS, async () => {
    const { getPaperSearchStatus } = await import('../lib/paper-search-integration.ts')
    return getPaperSearchStatus()
  })

  ipcMain.handle(PAPER_SEARCH_IPC_CHANNELS.GET_ENV, async () => {
    const { loadPaperSearchEnv } = await import('../lib/paper-search-integration.ts')
    return loadPaperSearchEnv()
  })

  ipcMain.handle(PAPER_SEARCH_IPC_CHANNELS.SET_ENV, async (_event, config: import('@asci/shared').PaperSearchEnvConfig) => {
    const { savePaperSearchEnv } = await import('../lib/paper-search-integration.ts')
    savePaperSearchEnv(config)
  })

  // ===== Runtime Provisioner 状态 =====

  // 查询 4 个内置工具（Node/Git/uv/Python）的校验状态。
  // 未注入时返回 idle 兜底（开发热重载初始化前的极短窗口）
  ipcMain.handle(RUNTIME_PROVISIONER_IPC_CHANNELS.GET_STATUS, async () => {
    try {
      return getRuntimeProvisioner().getStatus()
    } catch {
      return { phase: 'idle' }
    }
  })

  // ===== 能力包管理（配置页 → 能力包板块 · Codex 风只读展示，#414 CP-6） =====

  // 枚举所有已安装能力包（scenarioAgent / skill / mcp 引用 + manifest 校验状态）。
  // 只读：能力包默认启用、不可禁用、不导入/卸载，故无 toggle / import / uninstall 通道。
  ipcMain.handle(
    CAPABILITY_PACK_IPC_CHANNELS.LIST,
    async (): Promise<CapabilityPackListResponse> => {
      return listCapabilityPacks()
    },
  )
}

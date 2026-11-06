/**
 * 工作区文件监听器
 *
 * 使用 chokidar 跨平台监听 ~/.asci/agent-workspaces/ 目录，
 * 根据变化的文件路径区分事件类型：
 * - skills/ 变化 → 推送 CAPABILITIES_CHANGED（侧边栏刷新）
 * - 其他文件变化 → 推送 WORKSPACE_FILES_CHANGED（文件浏览器刷新）
 *
 * 同时支持监听附加目录（外部路径），变化时统一推送 WORKSPACE_FILES_CHANGED。
 *
 * 所有事件均做 debounce 防抖，避免高频文件操作导致渲染进程风暴。
 *
 * 兼容性：chokidar 解决了原生 fs.watch 在 macOS FSEvents 合并丢事件、
 * Windows filename 可能为 null 等问题；并通过 awaitWriteFinish 处理
 * Agent 写文件时的 "写入中" 中间态。
 */

import { existsSync } from 'node:fs'
import * as chokidar from 'chokidar'
import type { FSWatcher } from 'chokidar'
import type { BrowserWindow } from 'electron'
import { AGENT_IPC_CHANNELS } from '@asci/shared'
import { getAgentWorkspacesDir } from './config-paths'

/** 主监听器事件 debounce 延迟（ms） */
const DEBOUNCE_MS = 300
/** broadcastWorkspaceFilesChanged 兜底广播 debounce（ms） */
const BROADCAST_DEBOUNCE_MS = 200
const IS_BUN_RUNTIME = Boolean((process.versions as NodeJS.ProcessVersions & { bun?: string }).bun)

let watcher: FSWatcher | null = null
/** 监听器代际计数：stop 后递增；handler 内对比可在 close 异步完成前忽略事件 */
let watcherGeneration = 0

/** 附加目录监听器：路径 → FSWatcher */
const attachedWatchers = new Map<string, FSWatcher>()
/** 附加目录防抖定时器：按路径独立，避免一条 path 的 burst 吃掉另一条的刷新 */
const attachedFilesTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** 主窗口引用（供附加目录监听器与兜底广播使用） */
let mainWin: BrowserWindow | null = null

/** broadcastWorkspaceFilesChanged 内部 debounce 定时器 */
let broadcastTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 构造 chokidar 选项
 * - ignoreInitial: 启动时不为已有文件触发 add 事件
 * - awaitWriteFinish: 等 Agent 写完文件再触发，避免拿到半写状态
 * - atomic: 抹平编辑器 swap-write
 * - ignored: 仅跳过常见噪音目录；不能用点开头正则匹配隐藏文件，
 *   因为工作区根路径位于 .asci 下，会让整个监听静默失效。
 *   工作区内的 .context、隐藏文件由 listDirectory 层另行控制可见性。
 */
function createChokidarOptions(): chokidar.WatchOptions {
  return {
    ignoreInitial: true,
    persistent: true,
    // Bun 测试运行时当前环境下原生文件事件不触发；Electron/Node 生产仍走 chokidar 默认后端。
    usePolling: IS_BUN_RUNTIME,
    ignored: ['**/node_modules/**', '**/.git/**', '**/.DS_Store'],
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50,
    },
    atomic: 100,
  }
}

/**
 * 判断变化路径是否属于 skills/ 子树
 * chokidar 在所有平台默认输出 forward slash，但 Windows 可能仍带反斜杠，故两种写法都判定。
 */
function isCapabilitiesPath(p: string): boolean {
  return p.includes('/skills/') || p.includes('\\skills\\') || p.includes('\\skills/')
}

/**
 * 启动工作区文件监听
 *
 * @param win 主窗口引用，用于向渲染进程推送事件
 */
export function startWorkspaceWatcher(win: BrowserWindow): void {
  mainWin = win
  const watchDir = getAgentWorkspacesDir()

  if (!existsSync(watchDir)) {
    console.warn('[工作区监听] 目录不存在，跳过:', watchDir)
    return
  }

  // 防抖定时器：按事件类型分别 debounce
  let capabilitiesTimer: ReturnType<typeof setTimeout> | null = null
  let filesTimer: ReturnType<typeof setTimeout> | null = null
  // 捕获本次 start 的代际；stop 调用后 watcherGeneration 递增，此回调直接忽略事件
  const myGeneration = ++watcherGeneration

  const handleChange = (changedPath: string): void => {
    if (myGeneration !== watcherGeneration) return
    if (win.isDestroyed()) return

    if (isCapabilitiesPath(changedPath)) {
      if (capabilitiesTimer) clearTimeout(capabilitiesTimer)
      capabilitiesTimer = setTimeout(() => {
        capabilitiesTimer = null
        if (myGeneration !== watcherGeneration) return
        if (!win.isDestroyed()) {
          win.webContents.send(AGENT_IPC_CHANNELS.CAPABILITIES_CHANGED)
        }
      }, DEBOUNCE_MS)
    } else {
      if (filesTimer) clearTimeout(filesTimer)
      filesTimer = setTimeout(() => {
        filesTimer = null
        if (myGeneration !== watcherGeneration) return
        if (!win.isDestroyed()) {
          win.webContents.send(AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED)
        }
      }, DEBOUNCE_MS)
    }
  }

  watcher = chokidar.watch(watchDir, createChokidarOptions())

  watcher
    .on('add', handleChange)
    .on('change', handleChange)
    .on('unlink', handleChange)
    .on('addDir', handleChange)
    .on('unlinkDir', handleChange)
    .on('error', (error) => {
      console.error('[工作区监听] chokidar 错误:', error)
    })

  console.log('[工作区监听] 已启动文件监听:', watchDir)
}

/**
 * 停止工作区文件监听
 */
export function stopWorkspaceWatcher(): void {
  // 代际递增让所有 in-flight handler 立即变成 no-op，
  // 不必等 chokidar.close() 的异步完成
  watcherGeneration++
  if (watcher) {
    void watcher.close()
    watcher = null
    console.log('[工作区监听] 已停止')
  }
  // 同时清理所有附加目录监听器
  for (const [dirPath, w] of attachedWatchers) {
    void w.close()
    console.log('[附加目录监听] 已停止:', dirPath)
  }
  attachedWatchers.clear()
  for (const timer of attachedFilesTimers.values()) {
    clearTimeout(timer)
  }
  attachedFilesTimers.clear()
  if (broadcastTimer) {
    clearTimeout(broadcastTimer)
    broadcastTimer = null
  }
  mainWin = null
}

/**
 * 开始监听附加目录
 * 当目录内文件变化时，推送 WORKSPACE_FILES_CHANGED 事件
 */
export function watchAttachedDirectory(dirPath: string): void {
  if (attachedWatchers.has(dirPath)) return
  if (!existsSync(dirPath)) {
    console.warn('[附加目录监听] 目录不存在，跳过:', dirPath)
    return
  }

  const handleChange = (): void => {
    if (!mainWin || mainWin.isDestroyed()) return

    // 按路径独立 debounce
    const existing = attachedFilesTimers.get(dirPath)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send(AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED)
      }
      attachedFilesTimers.delete(dirPath)
    }, DEBOUNCE_MS)
    attachedFilesTimers.set(dirPath, timer)
  }

  const w = chokidar.watch(dirPath, createChokidarOptions())
  w.on('add', handleChange)
    .on('change', handleChange)
    .on('unlink', handleChange)
    .on('addDir', handleChange)
    .on('unlinkDir', handleChange)
    .on('error', (error) => {
      console.error('[附加目录监听] chokidar 错误:', dirPath, error)
    })

  attachedWatchers.set(dirPath, w)
  console.log('[附加目录监听] 已启动:', dirPath)
}

/**
 * 停止监听附加目录
 */
export function unwatchAttachedDirectory(dirPath: string): void {
  const w = attachedWatchers.get(dirPath)
  if (w) {
    void w.close()
    attachedWatchers.delete(dirPath)
    console.log('[附加目录监听] 已停止:', dirPath)
  }
  const timer = attachedFilesTimers.get(dirPath)
  if (timer) {
    clearTimeout(timer)
    attachedFilesTimers.delete(dirPath)
  }
}

/**
 * 主动广播 WORKSPACE_FILES_CHANGED（兜底通道）
 *
 * 当 orchestrator 观察到 Agent 触发 Write/Edit/MultiEdit/NotebookEdit/Bash 等
 * 可能写文件的工具时调用。独立于底层 chokidar 监听，即使 watcher 漏事件也能兜住。
 *
 * 内部 200ms debounce，避免一次回合多个 tool_use 触发 IPC 风暴。
 * mainWin 为 null 或已 destroyed 时静默 no-op。
 */
export function broadcastWorkspaceFilesChanged(): void {
  if (broadcastTimer) clearTimeout(broadcastTimer)
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null
    if (!mainWin || mainWin.isDestroyed()) return
    mainWin.webContents.send(AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED)
  }, BROADCAST_DEBOUNCE_MS)
}

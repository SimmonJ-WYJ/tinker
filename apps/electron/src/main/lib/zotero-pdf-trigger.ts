/**
 * Zotero PDF 自动触发层（按需启动 / 状态机）
 *
 * 三层触发架构：
 *   1. 生命周期事件：app activate / mainWindow focus / app whenReady（startup）
 *   2. 后台心跳：每 60s fs.stat(~/Zotero/zotero.sqlite).mtimeMs，变了才跑 diff
 *   3. 用户主动：IPC PDF_DIFF_NOW（manual） + 设置页"立即同步"按钮
 *
 * 状态机（按需轮询）：
 *   - startZoteroPdfAutoTrigger() 只注册 listener，**不立即启动 60s 心跳**
 *   - mode=dormant：listener 在，心跳停。等 focus/activate/manual/startup 跑一次 diff
 *     真正连上 Zotero 才切到 active；切换前几乎零开销
 *   - mode=active：listener + 心跳都在。心跳每 60s 检查 mtime
 *   - 切换由 triggerZoteroPdfDiff 末尾根据 result.status 自动完成：
 *       first-baseline / diff       → active
 *       skipped-zotero-offline /
 *       skipped-disabled            → dormant
 *       skipped-noop / error         → 不动 mode（保守，等下次重试）
 *
 * 防重入 + 节流：
 *   - inFlight Promise 复用，并发触发只跑一次 diff
 *   - heartbeat 分支：mtime 没变直接 noop（不调 ping/diff，避免 Zotero 关闭时刷屏）
 *
 * 不调用 zotero-pdf-diff 内部函数，纯外层调度；diff 失败 / Zotero 离线时
 * 不更新 mtime baseline，下次心跳能正常追上。
 */

import { app, type BrowserWindow } from 'electron'
import { statSync } from 'node:fs'
import type { ZoteroPdfDiffResult } from '@asci/shared'
import { nowMs } from '@asci/shared'
import { runZoteroPdfDiff } from './zotero-pdf-diff'
import { getZoteroSqlitePath } from './zotero-client/data-dir.ts'
import { getSettings } from './settings-service'

export type TriggerReason = 'startup' | 'activate' | 'focus' | 'heartbeat' | 'manual'

/** 心跳轮询间隔（fs.stat 几乎零成本） */
const HEARTBEAT_MS = 60_000

/** mtime 拿不到（自定义目录、文件不存在）时心跳的兜底周期 */
const FALLBACK_FULL_DIFF_MS = 5 * 60_000

// ===== 模块状态 =====

let inFlight: Promise<ZoteroPdfDiffResult> | null = null
let lastSqliteMtimeMs = 0
let lastDiffAtMs = 0
let heartbeatTimer: NodeJS.Timeout | null = null
let focusHandler: (() => void) | null = null
let activateHandler: (() => void) | null = null
let boundWindow: BrowserWindow | null = null
let started = false
let mode: 'dormant' | 'active' = 'dormant'

// ===== 公开 API =====

/**
 * 启动自动触发层：仅注册 focus / activate listener
 *
 * **不立即启动心跳** —— 等首次 triggerZoteroPdfDiff 拿到非 offline 的 result 才切到 active。
 * 必须在 mainWindow 创建后调用；重复调用是 no-op（幂等）。
 *
 * 调用方应该在 start 后调一次 triggerZoteroPdfDiff('startup') 让状态机自己决定 mode。
 */
export function startZoteroPdfAutoTrigger(mainWindow: BrowserWindow): void {
  if (started) {
    console.log('[Zotero PDF Auto] 已启动，跳过重复 start')
    return
  }
  started = true
  boundWindow = mainWindow
  mode = 'dormant'

  // mainWindow.on('focus')：用户切回 ASCI 窗口
  focusHandler = () => {
    void triggerZoteroPdfDiff('focus').catch((err) => {
      console.warn('[Zotero PDF Auto] focus 触发异常:', err)
    })
  }
  mainWindow.on('focus', focusHandler)

  // app.on('activate')：macOS Dock 点击 / 隐藏后再激活
  activateHandler = () => {
    void triggerZoteroPdfDiff('activate').catch((err) => {
      console.warn('[Zotero PDF Auto] activate 触发异常:', err)
    })
  }
  app.on('activate', activateHandler)

  console.log('[Zotero PDF Auto] 已启动：focus + activate listener（mode=dormant，等首次 diff 决定是否启心跳）')
}

/**
 * 停止自动触发层（before-quit 或 zoteroEnabled toggle off 调用）
 *
 * - clearInterval（如果有）
 * - 解绑 focus / activate listener
 * - 重置所有状态（mtime baseline 等）
 * - in-flight diff 不强制中止，让其自然完成
 */
export function stopZoteroPdfAutoTrigger(): void {
  if (!started) return
  started = false

  pauseHeartbeat()

  if (boundWindow && focusHandler && !boundWindow.isDestroyed()) {
    boundWindow.off('focus', focusHandler)
  }
  if (activateHandler) {
    app.off('activate', activateHandler)
  }
  focusHandler = null
  activateHandler = null
  boundWindow = null
  mode = 'dormant'

  // 重置 mtime baseline；下次重新启动时第一次 diff 会重新建立
  lastSqliteMtimeMs = 0
  lastDiffAtMs = 0

  console.log('[Zotero PDF Auto] 已停止')
}

/**
 * 统一入口；所有触发点（含 startup 和 manual IPC）都过这里。
 *
 * - 防重入：inFlight 存在则直接复用同一个 Promise
 * - heartbeat 分支：mtime 没变 → 直接返回 skipped-noop（不调 ping/diff，避免 Zotero
 *   关闭时反复 1.5s 超时刷屏）
 * - zoteroEnabled=false → 返回 skipped-disabled
 * - 失败（offline / error）不更新 mtime baseline，下次还能重试
 * - 跑完根据 result.status 自动 activate/pause 心跳
 */
export async function triggerZoteroPdfDiff(reason: TriggerReason): Promise<ZoteroPdfDiffResult> {
  // 1. 防重入
  if (inFlight) {
    console.log(`[Zotero PDF Auto] reason=${reason} 跳过：已有 in-flight diff`)
    return inFlight
  }

  // 2. 总开关短路
  if (!getSettings().zoteroEnabled) {
    pauseHeartbeat() // 双保险：心跳确保停掉
    return makeSkipped('skipped-disabled')
  }

  // 3. 读 mtime（拿不到也无所谓，作为兜底处理）
  const currentMtime = readSqliteMtime()
  const mtimeAvailable = currentMtime !== null
  const mtimeChanged = currentMtime !== lastSqliteMtimeMs

  // 4. heartbeat 分支：mtime 没变 → 直接 noop，连 ping/diff 都不调
  if (reason === 'heartbeat') {
    if (mtimeAvailable && !mtimeChanged) {
      return makeSkipped('skipped-noop') // 静默，不打日志
    }
    if (!mtimeAvailable && nowMs() - lastDiffAtMs < FALLBACK_FULL_DIFF_MS) {
      return makeSkipped('skipped-noop') // mtime 拿不到时降到 5min 兜底
    }
    // 否则继续走 diff
  }

  console.log(
    `[Zotero PDF Auto] 触发 diff: reason=${reason}, mode=${mode}, mtimeChanged=${mtimeChanged}, mtimeAvailable=${mtimeAvailable}`,
  )

  inFlight = (async () => {
    try {
      const result = await runZoteroPdfDiff()
      // 仅"跑成功且 zotero 在线"才更新 baseline；offline/error 下次还能重试
      if (result.status !== 'skipped-zotero-offline' && result.status !== 'error') {
        if (currentMtime !== null) lastSqliteMtimeMs = currentMtime
        lastDiffAtMs = nowMs()
      }
      // 状态机切换：根据 result.status 决定是否启用心跳
      applyResultToMode(result)
      return result
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

// ===== 内部状态机 =====

/**
 * 根据 diff 结果切换 mode：
 *   first-baseline / diff             → active（连上了，启动心跳）
 *   skipped-zotero-offline / disabled → dormant（断了，停心跳）
 *   skipped-noop / error              → 不动（保守）
 */
function applyResultToMode(result: ZoteroPdfDiffResult): void {
  switch (result.status) {
    case 'first-baseline':
    case 'diff':
      activateHeartbeat()
      break
    case 'skipped-zotero-offline':
    case 'skipped-disabled':
      pauseHeartbeat()
      break
    case 'skipped-noop':
    case 'error':
      // 保守：不动当前 mode，等下次重试
      break
  }
}

function activateHeartbeat(): void {
  if (!started) return
  if (heartbeatTimer) return // 已激活
  heartbeatTimer = setInterval(() => {
    void triggerZoteroPdfDiff('heartbeat').catch((err) => {
      console.warn('[Zotero PDF Auto] heartbeat 触发异常:', err)
    })
  }, HEARTBEAT_MS)
  if (mode !== 'active') {
    mode = 'active'
    console.log(`[Zotero PDF Auto] 进入 active：${HEARTBEAT_MS / 1000}s 心跳启动`)
  }
}

function pauseHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  if (mode !== 'dormant') {
    mode = 'dormant'
    console.log('[Zotero PDF Auto] 进入 dormant：心跳暂停（等待 focus/activate/manual 重新连上 Zotero）')
  }
}

// ===== 内部辅助 =====

function readSqliteMtime(): number | null {
  try {
    return statSync(getZoteroSqlitePath()).mtimeMs
  } catch {
    return null
  }
}

function makeSkipped(status: 'skipped-disabled' | 'skipped-noop'): ZoteroPdfDiffResult {
  return {
    status,
    total: 0,
    added: [],
    modified: [],
    deleted: [],
  }
}

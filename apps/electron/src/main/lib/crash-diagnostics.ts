/**
 * 崩溃诊断（issue #459）
 *
 * Windows 概率性「窗口半透明 + 闪退」此前无任何崩溃信号落盘，无法根因。
 * 本模块统一捕获主进程 / 渲染进程 / 子进程崩溃与未捕获异常，做两件事：
 *   1. append-only 写 ~/.asci/crash-logs/crash.jsonl（结构化，便于事后排查）
 *   2. 转发 Sentry（携带 reason / exitCode / GPU 状态等上下文，补足原生 minidump
 *      无诊断字段的短板）—— 门控与 sentry-init.ts 完全一致，未 init 时整段 noop
 *
 * 注意：本模块只「检测 + 落盘 + 上报」，不自动降级硬件加速（用户决策：先拿到
 * 真实 crash dump 确认 GPU 是否真凶，避免盲目全局软渲染影响性能）。
 */

import { app } from 'electron'
import type { BrowserWindow, GPUFeatureStatus } from 'electron'
import { appendFileSync } from 'node:fs'
import { nowIso } from '@asci/shared'
import { getCrashLogPath } from './config-paths.ts'
import { getActiveSentryMain } from './telemetry/sentry-init.ts'

/** 崩溃类型 */
type CrashKind =
  | 'render-process-gone'
  | 'child-process-gone'
  | 'webcontents-unresponsive'
  | 'uncaughtException'
  | 'unhandledRejection'

/** 落盘 + 上报的结构化崩溃记录 */
interface CrashRecord {
  /** ISO 时间戳（dayjs nowIso，禁裸 new Date） */
  ts: string
  kind: CrashKind
  platform: NodeJS.Platform
  appVersion: string
  electronVersion: string
  chromeVersion: string
  /** Electron 给出的崩溃原因（如 crashed / oom / killed / launch-failed） */
  reason?: string
  exitCode?: number
  /** child-process-gone 的子进程类型（如 GPU / utility / renderer） */
  processType?: string
  /** 异常 message（uncaughtException / unhandledRejection） */
  message?: string
  stack?: string
  /** GPU 特性状态快照（app ready 后才可取），辅助判断是否 GPU 相关 */
  gpuFeatureStatus?: GPUFeatureStatus
}

/** GPU 特性状态快照（仅 app ready 后可取，未 ready 返回 undefined） */
function snapshotGpu(): GPUFeatureStatus | undefined {
  try {
    return app.isReady() ? app.getGPUFeatureStatus() : undefined
  } catch {
    return undefined
  }
}

/** 组装崩溃记录（统一填充版本号 / 平台 / GPU 快照等公共字段） */
function buildRecord(kind: CrashKind, partial: Partial<CrashRecord>): CrashRecord {
  return {
    ts: nowIso(),
    kind,
    platform: process.platform,
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? 'unknown',
    chromeVersion: process.versions.chrome ?? 'unknown',
    gpuFeatureStatus: snapshotGpu(),
    ...partial,
  }
}

/**
 * 记录一次崩溃：落盘 JSONL + console + 转发 Sentry。
 * 任一环节失败都不抛（崩溃处理本身不应再崩）。
 */
function recordCrash(record: CrashRecord): void {
  // ① append-only 落盘
  try {
    appendFileSync(getCrashLogPath(), JSON.stringify(record) + '\n', 'utf-8')
  } catch (err) {
    console.warn('[崩溃诊断] 写崩溃日志失败（忽略）:', err)
  }

  // ② console（即使 Sentry / 落盘都没成功，至少有终端线索）
  console.error(`[崩溃诊断] ${record.kind}:`, record)

  // ③ 转发 Sentry（未 init 时 getActiveSentryMain()=null，整段 noop）
  try {
    const Sentry = getActiveSentryMain()
    if (!Sentry) return
    Sentry.setTag('crash.kind', record.kind)
    Sentry.setContext('crash', { ...record })
    if (record.stack || record.message) {
      const err = new Error(record.message ?? record.kind)
      if (record.stack) err.stack = record.stack
      Sentry.captureException(err)
    } else {
      Sentry.captureMessage(`crash:${record.kind} reason=${record.reason ?? 'unknown'}`)
    }
  } catch (err) {
    console.warn('[崩溃诊断] Sentry 上报失败（忽略）:', err)
  }
}

/** 把未知异常归一化为 { message, stack } */
function normalizeError(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) {
    return { message: reason.message, stack: reason.stack }
  }
  return { message: typeof reason === 'string' ? reason : JSON.stringify(reason) }
}

/**
 * 注册进程级崩溃诊断：app 的 render/child-process-gone +
 * process 的 uncaughtException / unhandledRejection。
 * 尽早调用（app ready 前）以覆盖启动期异常。
 */
export function registerProcessCrashDiagnostics(): void {
  app.on('render-process-gone', (_event, _webContents, details) => {
    recordCrash(
      buildRecord('render-process-gone', {
        reason: details.reason,
        exitCode: details.exitCode,
      }),
    )
  })

  app.on('child-process-gone', (_event, details) => {
    recordCrash(
      buildRecord('child-process-gone', {
        reason: details.reason,
        exitCode: details.exitCode,
        processType: details.type,
      }),
    )
  })

  process.on('uncaughtException', (err) => {
    recordCrash(buildRecord('uncaughtException', normalizeError(err)))
  })

  process.on('unhandledRejection', (reason) => {
    recordCrash(buildRecord('unhandledRejection', normalizeError(reason)))
  })

  console.log('[崩溃诊断] 进程级崩溃监听已注册')
}

/**
 * 注册某个窗口的 webContents 崩溃诊断：render-process-gone（更细的窗口级信号）
 * 与 unresponsive（卡死，半透明 + 闪退的可能前兆）。
 */
export function registerWebContentsCrashDiagnostics(win: BrowserWindow): void {
  win.webContents.on('render-process-gone', (_event, details) => {
    recordCrash(
      buildRecord('render-process-gone', {
        reason: details.reason,
        exitCode: details.exitCode,
      }),
    )
  })

  win.webContents.on('unresponsive', () => {
    recordCrash(buildRecord('webcontents-unresponsive', {}))
  })
}

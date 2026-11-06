/**
 * session 论文集文件监听器
 *
 * 使用 chokidar 监听 ~/.asci/agent-sessions-papers/ 目录，按文件名区分两类变化，
 * 推送 SESSION_PAPERS_CHANGED 事件给所有窗口（替代渲染侧 5s 轮询）：
 * - {sessionId}.live.json  → kind='live'      检索流式进度（paper-search MCP 每源完成时原子写）
 * - {sessionId}.jsonl      → kind='canonical' 正式落盘（retrieve 去重写入 / apply_rerank 回写）
 *
 * canonical 落盘后除推送事件外，还触发 reflowSessionToWorkspace 把检索结果回流刷新到
 * workspace 已加入条目（仅升级已存在条目，见 #702 / session-papers-reflow.ts）。
 *
 * 防抖按 (sessionId, kind) 分键：
 * - live 150ms：每源完成一次原子 rename，要跟手；
 * - canonical 250ms：Python MCP 连续追加写较快，去抖窗口稍长以把连续写合并成一次 IPC + 一次回流。
 *
 * 监听目录可能在首次检索前不存在（首次写 JSONL 时由 MCP/recorder mkdir），
 * 因此监听父目录不可行；改为启动时确保目录存在再 watch。
 */

import { existsSync, mkdirSync } from 'node:fs'
import { basename } from 'node:path'
import * as chokidar from 'chokidar'
import type { FSWatcher } from 'chokidar'
import { BrowserWindow } from 'electron'
import { AGENT_IPC_CHANNELS } from '@asci/shared'
import type { SessionPapersChangedEvent } from '@asci/shared'
import { getAgentSessionsPapersDir } from './config-paths'
import { reflowSessionToWorkspace } from './session-papers-reflow'

/** live 进度事件 debounce（ms）：原子 rename 无半写态，跟手优先 */
const LIVE_DEBOUNCE_MS = 150
/** canonical 落盘事件 debounce（ms）：合并 Python + recorder 双写 */
const CANONICAL_DEBOUNCE_MS = 250
const IS_BUN_RUNTIME = Boolean((process.versions as NodeJS.ProcessVersions & { bun?: string }).bun)

let watcher: FSWatcher | null = null
/** 监听器代际计数：stop 后递增；handler 内对比可在 close 异步完成前忽略事件 */
let watcherGeneration = 0
/** 防抖定时器：key = `${sessionId}:${kind}` */
const emitTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** 从变化路径解析 (sessionId, kind)；tmp 等无关文件返回 null */
function parseChangedPath(p: string): SessionPapersChangedEvent | null {
  const name = basename(p)
  if (name.endsWith('.live.json')) {
    return { sessionId: name.slice(0, -'.live.json'.length), kind: 'live' }
  }
  if (name.endsWith('.jsonl')) {
    return { sessionId: name.slice(0, -'.jsonl'.length), kind: 'canonical' }
  }
  return null
}

/** 按 (sessionId, kind) 防抖后向所有窗口广播 */
function scheduleEmit(event: SessionPapersChangedEvent, myGeneration: number): void {
  const key = `${event.sessionId}:${event.kind}`
  const delay = event.kind === 'live' ? LIVE_DEBOUNCE_MS : CANONICAL_DEBOUNCE_MS
  const existing = emitTimers.get(key)
  if (existing) clearTimeout(existing)
  emitTimers.set(
    key,
    setTimeout(() => {
      emitTimers.delete(key)
      if (myGeneration !== watcherGeneration) return
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) {
          w.webContents.send(AGENT_IPC_CHANNELS.SESSION_PAPERS_CHANGED, event)
        }
      }
      // canonical 落盘后把本会话检索结果回流刷新到 workspace 已加入条目（#702）。
      // live 进度（流式未定稿）不触发，避免重复回流。
      if (event.kind === 'canonical') {
        reflowSessionToWorkspace(event.sessionId)
      }
    }, delay),
  )
}

/**
 * 启动 session 论文集监听
 *
 * 目录不存在时主动创建（MCP/recorder 首次写入也会 mkdir，双方幂等），
 * 保证应用启动即开始监听，而不是等首次检索后重启才生效。
 */
export function startSessionPapersWatcher(): void {
  const watchDir = getAgentSessionsPapersDir()
  try {
    if (!existsSync(watchDir)) mkdirSync(watchDir, { recursive: true })
  } catch (err) {
    console.error('[检索进度监听] 创建监听目录失败，跳过启动:', err)
    return
  }

  const myGeneration = ++watcherGeneration

  const handleChange = (changedPath: string): void => {
    if (myGeneration !== watcherGeneration) return
    const event = parseChangedPath(changedPath)
    if (!event) return
    scheduleEmit(event, myGeneration)
  }

  watcher = chokidar.watch(watchDir, {
    ignoreInitial: true,
    persistent: true,
    // Bun 测试运行时当前环境下原生文件事件不触发；Electron/Node 生产仍走 chokidar 默认后端。
    usePolling: IS_BUN_RUNTIME,
    // 原子写的 .tmp 中间文件不触发事件
    ignored: ['**/*.tmp', '**/.DS_Store'],
    // live 文件走 tmp+rename 原子写，无半写态；JSONL 追加写较快——
    // 稳定窗口取短值，事件延迟主要交给上层 debounce 控制
    awaitWriteFinish: {
      stabilityThreshold: 120,
      pollInterval: 40,
    },
    atomic: 100,
  })

  watcher
    .on('add', handleChange)
    .on('change', handleChange)
    .on('unlink', handleChange)
    .on('error', (error) => {
      console.error('[检索进度监听] chokidar 错误:', error)
    })

  console.log('[检索进度监听] 已启动:', watchDir)
}

/** 停止 session 论文集监听 */
export function stopSessionPapersWatcher(): void {
  // 代际递增让 in-flight handler / 未触发的定时器立即失效
  watcherGeneration++
  for (const timer of emitTimers.values()) clearTimeout(timer)
  emitTimers.clear()
  if (watcher) {
    void watcher.close()
    watcher = null
    console.log('[检索进度监听] 已停止')
  }
}

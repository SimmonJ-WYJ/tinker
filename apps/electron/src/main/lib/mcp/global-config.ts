/**
 * 全局 MCP 配置 IO
 *
 * 真相源：~/.asci/mcp.json（dev: ~/.asci-dev/mcp.json）
 * 仅存放用户自定义 server；内建 MCP 永不写盘。
 */

import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { AGENT_IPC_CHANNELS, nowMs } from '@asci/shared'
import type { GlobalMcpConfig, McpServerEntry } from '@asci/shared'
import {
  getGlobalMcpPath,
  getAsrWeightsDir,
  getAsrCacheDir,
  getConfigEnvForChildren,
} from '../config-paths.ts'
import { readJsonFileSafe, writeJsonFileAtomic } from '../safe-file.ts'
import {
  resolveBuiltinMcpServers,
  buildBuiltinResolverInputFromEnv,
} from './builtin-mcp-resolver.ts'
import { getSettings } from '../settings-service.ts'
import {
  getOcrServerCjsPath,
  getAsrServerCjsPath,
} from '../zotero-integration.ts'

export function getGlobalMcpConfig(): GlobalMcpConfig {
  const parsed = readJsonFileSafe<Partial<GlobalMcpConfig>>(getGlobalMcpPath())
  return { servers: parsed?.servers ?? {} }
}

/**
 * 自身写入时间戳：saveGlobalMcpConfig 写盘前打点，watcher 在 grace 窗口内忽略
 * 由 rename / .bak copy 触发的回声事件，避免重复广播。
 */
let lastSelfWriteAt = 0
const SELF_WRITE_GRACE_MS = 1500

/** Watcher 用：判断当前 fsWatch 事件是否由本进程的 saveGlobalMcpConfig 引发 */
export function isRecentSelfWrite(): boolean {
  return nowMs() - lastSelfWriteAt < SELF_WRITE_GRACE_MS
}

/** 启动时调用：mcp.json 不存在则写入空 {servers:{}}，让 fsWatch 有节点可监听 */
export function ensureGlobalMcpFile(): void {
  const path = getGlobalMcpPath()
  if (existsSync(path)) return
  mkdirSync(dirname(path), { recursive: true })
  // skipBackup: 首次创建无可备份的旧文件
  writeJsonFileAtomic(path, { servers: {} }, true)
}

/** 向所有窗口广播 MCP 全局变更；测试环境（无 Electron 上下文）无窗口可广播，静默 noop */
function broadcastMcpGlobalChanged(): void {
  let BrowserWindow: typeof import('electron').BrowserWindow | undefined
  try {
    // 延迟 require 避免 bun test 在 Node 上下文 import 时崩；
    // bun test 下 require('electron') 可能返回 stub（BrowserWindow 为 undefined），同样视作测试环境
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    BrowserWindow = (require('electron') as typeof import('electron')).BrowserWindow
  } catch {
    // require 失败：noop
    return
  }
  if (!BrowserWindow) return
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    try {
      win.webContents.send(AGENT_IPC_CHANNELS.MCP_GLOBAL_CHANGED)
    } catch (err) {
      // 窗口 destroy 中途等竞态：不静默吞，方便日后定位"保存了但 UI 没收到通知"的诡异 bug
      console.warn('[全局 MCP] 广播 MCP_GLOBAL_CHANGED 失败:', err)
    }
  }
}

export function saveGlobalMcpConfig(config: GlobalMcpConfig): void {
  const path = getGlobalMcpPath()
  mkdirSync(dirname(path), { recursive: true })
  try {
    // 先标记 self-write，再写盘：即使 fsWatch 在 writeFileSync/renameSync 中途回调
    // 也能正确判定为自身回声。grace 窗口足以覆盖 rename + .bak copy 的全过程。
    lastSelfWriteAt = nowMs()
    writeJsonFileAtomic(path, config)
    console.log('[全局 MCP] 已保存配置')
    // 直接广播，绕过 fsWatch 的 300ms debounce 与丢/重事件 race
    broadcastMcpGlobalChanged()
  } catch (error) {
    console.error('[全局 MCP] 保存配置失败:', error)
    throw new Error('保存全局 MCP 配置失败')
  }
}

/** 合并视图条目类型：base McpServerEntry 持久化层永不带 isBuiltin，仅 capabilities/UI 视图带 */
export type ComposedMcpServerEntry = McpServerEntry & { isBuiltin?: boolean }

/**
 * 合并用户全局 server + 内建 server。内建覆盖同名用户。
 * 返回结构带 isBuiltin 视图字段（仅供 UI/capabilities 使用，不写盘）。
 */
export function composeMcpServers(): Record<string, ComposedMcpServerEntry> {
  const userServers = getGlobalMcpConfig().servers
  const builtin = resolveBuiltinMcpServers(buildBuiltinResolverInputFromEnv({
    getSettings: () => {
      const s = getSettings()
      return {
        // OCR 默认 true（PaddleOCR 已内置打包，无下载成本）
        zoteroOcrEnabled: s.zoteroOcrEnabled ?? true,
        // ASR 默认 false（模型 ~1GB，要用户主动开启触发下载）
        zoteroAsrEnabled: s.zoteroAsrEnabled ?? false,
      }
    },
    getOcrServerCjsPath,
    getAsrServerCjsPath,
    getAsrWeightsDir,
    getAsrCacheDir,
    getConfigEnvForChildren,
  }))

  const merged: Record<string, ComposedMcpServerEntry> = { ...userServers }
  for (const [name, entry] of Object.entries(builtin)) {
    merged[name] = { ...entry, isBuiltin: true }
  }
  return merged
}

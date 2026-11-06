/**
 * 一次性迁移：把 per-workspace mcp.json 合并到全局，删除工作区文件
 *
 * - 幂等：~/.asci/mcp.json 已存在则直接退出
 * - 跳过：保留名（zotero/ocr/asr/paper-search）+ isBuiltin: true 标记
 * - 同名冲突：先到先得 + warn 日志
 * - 失败兜底：try/catch 包住全函数，半成品全局文件清理后下次启动重试
 */

import { existsSync, unlinkSync, mkdirSync } from 'node:fs'
import { readJsonFileSafe, writeJsonFileAtomic } from '../safe-file.ts'
import { dirname, join } from 'node:path'
import type { GlobalMcpConfig, McpServerEntry } from '@asci/shared'
import { getAgentWorkspacePath, getGlobalMcpPath } from '../config-paths.ts'
import { listAgentWorkspaces } from '../agent-workspace-manager.ts'
import { BUILTIN_MCP_NAMES } from './builtin-mcp-resolver.ts'

/** 获取工作区旧版 mcp.json 路径 */
function getLegacyWorkspaceMcpPath(slug: string): string {
  return join(getAgentWorkspacePath(slug), 'mcp.json')
}

/** 去除 isBuiltin 标记字段，避免脏数据写入全局 */
function stripBuiltinFlag(entry: McpServerEntry & { isBuiltin?: boolean }): McpServerEntry {
  const { isBuiltin: _ignored, ...rest } = entry
  return rest
}

/**
 * 将所有工作区的用户自定义 MCP server 合并到全局 mcp.json，
 * 成功后删除各工作区的 mcp.json。
 *
 * 幂等：全局文件已存在则立即返回。
 */
export function migrateWorkspaceMcpToGlobal(): void {
  const globalPath = getGlobalMcpPath()
  if (existsSync(globalPath)) return // 幂等

  let createdGlobal = false
  try {
    const merged: Record<string, McpServerEntry> = {}
    let skippedBuiltin = 0
    let conflictDropped = 0

    for (const ws of listAgentWorkspaces()) {
      const wsPath = getLegacyWorkspaceMcpPath(ws.slug)
      if (!existsSync(wsPath)) continue

      // 旧 workspace mcp.json 也是经 writeJsonFileAtomic 写入的，可能有 .tmp/.bak
      // 半轮替文件；用 readJsonFileSafe 与原子写对称，避免裸 parse 失败让该工作区
      // 配置静默丢失。
      const cfg = readJsonFileSafe<{
        servers?: Record<string, McpServerEntry & { isBuiltin?: boolean }>
      }>(wsPath)
      if (!cfg) {
        console.warn(`[MCP 迁移] ${ws.slug}/mcp.json 读取失败（含 .tmp/.bak 回退），跳过`)
        continue
      }

      for (const [name, entry] of Object.entries(cfg.servers ?? {})) {
        // 跳过保留名 + isBuiltin 标记
        if (BUILTIN_MCP_NAMES.has(name) || entry.isBuiltin) {
          skippedBuiltin++
          continue
        }
        // 同名冲突：先到先得
        if (merged[name]) {
          console.warn(
            `[MCP 迁移] 同名 server "${name}" 在多个工作区出现；保留先到，丢弃 ${ws.slug}`,
          )
          conflictDropped++
          continue
        }
        merged[name] = stripBuiltinFlag(entry)
      }
    }

    // 写全局文件
    mkdirSync(dirname(globalPath), { recursive: true })
    const out: GlobalMcpConfig = { servers: merged }
    writeJsonFileAtomic(globalPath, out)
    createdGlobal = true

    // 删除各工作区的旧 mcp.json
    for (const ws of listAgentWorkspaces()) {
      const wsPath = getLegacyWorkspaceMcpPath(ws.slug)
      if (existsSync(wsPath)) {
        try {
          unlinkSync(wsPath)
        } catch (e) {
          console.warn(`[MCP 迁移] 删除 ${wsPath} 失败:`, e)
        }
      }
    }

    console.log(
      `[MCP 迁移] 完成：写入 ${Object.keys(merged).length} 个用户 server，` +
        `跳过 ${skippedBuiltin} 个内建条目，丢弃 ${conflictDropped} 个同名冲突`,
    )
  } catch (error) {
    console.error('[MCP 迁移] 失败，将在下次启动重试:', error)
    // 清理半成品全局文件，让下次启动重试
    if (createdGlobal && existsSync(globalPath)) {
      try {
        unlinkSync(globalPath)
      } catch {}
    }
  }
}

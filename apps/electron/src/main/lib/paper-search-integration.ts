/**
 * Paper Search MCP 集成管理器（主进程）
 *
 * 职责：
 * 1. 将 paper-search MCP（Python）注入到 workspace 的 mcp.json 中
 * 2. 启动时自愈路径（与 zotero-integration 同模式）
 * 3. 管理 paper-search 的环境变量配置（API Key 等）
 *
 * paper-search 是一个 Python MCP server，通过 `uv run` 启动，
 * 支持 22+ 学术数据源的并行检索、引文追溯、PDF 下载等。
 *
 * Python 包位于 apps/electron/resources/paper-search-mcp/，
 * 作为 Alpha 独立维护的副本（源自 ASCI2，ASCI2 后续将弃用）。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execSync, spawn } from 'node:child_process'
import type { PaperSearchStatus, PaperSearchEnvConfig } from '@asci/shared'
import { errMsg } from '@asci/shared'
import { getPythonUvBin } from './python/paths.ts'

// ===== 路径工具 =====

/**
 * 返回 resources 根目录（与 zotero-integration 共用逻辑）。
 *
 * 生产：electron-builder 把 resources/ 复制到 app bundle 的 Resources 下
 * 开发：resources 在源目录
 */
function getResourcesBase(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require('electron') as typeof import('electron')
  return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
}

/**
 * paper-search Python 包的根目录。
 *
 * 关键：uv 启动 MCP 时需要在该目录创建 `.venv/`，**必须**用户可写。
 * - 打包模式：`~/Library/Application Support/ASCI/paper-search-mcp/`（由 RuntimeBootstrapper
 *   首启时从 .app 只读资源拷贝过来；与 runtimes/ 同辈，单源在 runtime/paths.ts）
 * - 开发模式：源码树 `apps/electron/resources/paper-search-mcp/`（开发者本地可写）
 */
export function getPaperSearchPackageDir(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require('electron') as typeof import('electron')
  if (app.isPackaged) {
    // 延迟导入避免循环依赖
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getPaperSearchPackageDir: getRuntimePaperSearchDir } =
      require('./runtime/paths.ts') as typeof import('./runtime/paths.ts')
    return getRuntimePaperSearchDir()
  }
  return join(getResourcesBase(), 'paper-search-mcp')
}

/** paper-search 的 .env 配置文件路径（存放用户的 API Key 等） */
function getPaperSearchEnvFilePath(): string {
  // 延迟导入避免循环依赖
  const { getConfigDir } = require('./config-paths') as { getConfigDir: () => string }
  return join(getConfigDir(), 'paper-search.env')
}

// ===== 运行时检测 =====

/**
 * 查找当前可用的 uv 二进制路径，按优先级返回第一个存在的：
 *   1. PythonRuntimeService 部署的内置 uv（getPythonUvBin()，绝对路径）
 *   2. PATH 上的系统 uv（返回字符串 'uv'，由 spawn 走 PATH 解析）
 *
 * 都没有时返回 null。不缓存：PythonRuntimeService 异步激活完成后
 * uv 会从无到有，缓存会让 ensurePaperSearchMcp 永远停留在错误判断上。
 */
export function findUvBin(): string | null {
  const bundled = getPythonUvBin()
  if (existsSync(bundled)) return bundled

  try {
    const cmd = process.platform === 'win32' ? 'where uv' : 'which uv'
    execSync(cmd, { stdio: 'ignore', timeout: 3000 })
    return 'uv'
  } catch {
    return null
  }
}

// ===== 状态查询 =====

/** 获取 paper-search MCP 当前状态：uv 是否可用决定能否启用 */
export function getPaperSearchStatus(): PaperSearchStatus {
  return {
    runtimeAvailable: findUvBin() !== null,
  }
}

// ===== venv 预同步（消除并发 uv run 竞争）=====

/**
 * 一次性 venv 预同步的串行缓存：null=未开始/上次失败可重试；non-null=进行中或已成功完成。
 */
let venvSyncPromise: Promise<void> | null = null

/**
 * 幂等、串行地对 paper-search 的 `.venv` 执行一次 `uv sync --extra mcp`。
 *
 * 根因背景：paper-search MCP 由多个并发 agent（lead + 各 subagent）各自 `uv run` 拉起；
 * `uv run` 每次会重建 hatchling 的 editable 安装，**并发重建会持久损坏共享 `.venv` 的
 * `_editable_impl_paper_search.pth`** → `import paper_search` 失败 → MCP 初始化 failed →
 * Agent 退回 WebSearch → 右侧 paper 侧边栏无数据源（列表为空）。
 *
 * 修复策略：spawn 参数改用 `uv run --no-sync`（见 builtin-mcp-resolver），不再每次触碰
 * venv；并在首个会话启动前由本函数做一次串行同步，保证 venv 一定就绪。之后所有 --no-sync
 * 的并发 spawn 都不会重建 editable 安装，竞争消除。
 *
 * - 幂等：进程生命周期内只真正同步一次（模块级 promise 缓存）；成功后常驻缓存。
 * - 串行：并发调用共享同一 promise，绝不并发跑多个 `uv sync`。
 * - 容错：uv 不可用 / 包目录缺失 / 同步失败都只 warn 不抛；失败时清空缓存允许后续重试。
 *   最坏情况退化为修复前行为（spawn 自行按老路径失败），不会更糟。
 */
export function ensurePaperSearchVenvSynced(): Promise<void> {
  if (venvSyncPromise) return venvSyncPromise
  venvSyncPromise = (async () => {
    const uvBin = findUvBin()
    if (!uvBin) {
      console.warn('[paper-search] uv 不可用，跳过 venv 预同步')
      return
    }
    const packageDir = getPaperSearchPackageDir()
    if (!existsSync(packageDir)) {
      console.warn(`[paper-search] 包目录不存在，跳过 venv 预同步: ${packageDir}`)
      return
    }
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        uvBin,
        ['sync', '--extra', 'mcp', '--directory', packageDir],
        { stdio: 'ignore' },
      )
      child.on('error', (err) => reject(err))
      child.on('close', (code) => {
        if (code === 0) {
          console.log('[paper-search] venv 预同步完成')
          resolve()
        } else {
          reject(new Error(`uv sync 退出码 ${code}`))
        }
      })
    })
  })().catch((err) => {
    // 失败清空缓存：下个会话可重试（同步本身串行，不会与老失败并发）
    venvSyncPromise = null
    console.warn('[paper-search] venv 预同步失败（不阻塞，spawn 将按老路径尝试）:', errMsg(err))
  })
  return venvSyncPromise
}

// ===== 环境变量管理 =====

/**
 * 从配置目录下的 paper-search.env 加载用户配置的环境变量。
 * 路径：开发 ~/.asci-dev/paper-search.env，生产 ~/.asci/paper-search.env
 * 文件格式：KEY=VALUE，一行一个，#开头为注释。
 */
export function loadPaperSearchEnv(): PaperSearchEnvConfig {
  const envPath = getPaperSearchEnvFilePath()
  if (!existsSync(envPath)) return {}

  const content = readFileSync(envPath, 'utf-8')
  const vars: Record<string, string> = {}

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex <= 0) continue
    const key = trimmed.slice(0, eqIndex).trim()
    const value = trimmed.slice(eqIndex + 1).trim()
    vars[key] = value
  }

  return {
    unpaywall_email: vars.PAPER_SEARCH_MCP_UNPAYWALL_EMAIL || undefined,
    semantic_scholar_api_key: vars.PAPER_SEARCH_MCP_SEMANTIC_SCHOLAR_API_KEY || undefined,
    core_api_key: vars.PAPER_SEARCH_MCP_CORE_API_KEY || undefined,
    ieee_api_key: vars.PAPER_SEARCH_MCP_IEEE_API_KEY || undefined,
  }
}

/**
 * 保存用户配置的环境变量到配置目录下的 paper-search.env。
 * 同时刷新所有已启用 paper-search 的 workspace mcp.json 中的 env。
 */
export function savePaperSearchEnv(config: PaperSearchEnvConfig): void {
  const envPath = getPaperSearchEnvFilePath()
  mkdirSync(dirname(envPath), { recursive: true })

  const lines = [
    '# Paper Search MCP 环境变量配置',
    '# 由 ASCI 自动管理，也可手动编辑',
    '',
  ]

  if (config.unpaywall_email) {
    lines.push(`PAPER_SEARCH_MCP_UNPAYWALL_EMAIL=${config.unpaywall_email}`)
  }
  if (config.semantic_scholar_api_key) {
    lines.push(`PAPER_SEARCH_MCP_SEMANTIC_SCHOLAR_API_KEY=${config.semantic_scholar_api_key}`)
  }
  if (config.core_api_key) {
    lines.push(`PAPER_SEARCH_MCP_CORE_API_KEY=${config.core_api_key}`)
  }
  if (config.ieee_api_key) {
    lines.push(`PAPER_SEARCH_MCP_IEEE_API_KEY=${config.ieee_api_key}`)
  }

  writeFileSync(envPath, lines.join('\n') + '\n', 'utf-8')
}

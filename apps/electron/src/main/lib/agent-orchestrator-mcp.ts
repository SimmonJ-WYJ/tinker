/** 组装通用 Python/PDF/媒体与用户自定义 MCP；不构造应用科研服务。 */

import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { app } from 'electron'
import { PythonSkillVenvManager } from './python/python-skill-venv-manager.ts'
import { createUvSpawnInvoker } from './python/uv-spawn-invoker.ts'
import { createAsciPythonMcpServer } from '../mcp/asci-python-tool.ts'
import { getDefaultSkillsDir, getAgentWorkspacePath } from './config-paths.ts'
import { getRuntimeProvisioner } from './runtime/runtime-provisioner.ts'
import { composeMcpServers } from './mcp/global-config.ts'
import { buildPathWithBundledPrefix } from './agent-orchestrator-sdk-env.ts'

/**
 * 构建工作区 MCP 服务器配置
 *
 * @param deps Python runtime 就绪标志
 */
export async function buildMcpServers(
  deps: {
    isPythonRuntimeReady: boolean
  },
  workspaceSlug: string | undefined,
): Promise<Record<string, Record<string, unknown>>> {
  const { isPythonRuntimeReady } = deps
  const mcpServers: Record<string, Record<string, unknown>> = {}

  // 注入 in-process Python 工具（不依赖 workspaceSlug；每次新建实例避免单例冻结路径）
  // 仅在 Python runtime 已激活就绪时注入；否则该工具暂时缺席（避免 uv 调用 ENOENT）
  if (isPythonRuntimeReady) {
    mcpServers['asci-python'] = createAsciPythonMcpServer({
      venvManager: new PythonSkillVenvManager({
        skillsRootDir: getDefaultSkillsDir(),
        interpreterPath: getRuntimeProvisioner().getPythonInterpreter(),
        uv: createUvSpawnInvoker({ uvBinPath: getRuntimeProvisioner().getUvBin() }),
      }),
    }) as unknown as Record<string, unknown>
  }

  // 全局 MCP（用户自定义 + 内建 OCR/ASR）—— composeMcpServers 已合并好
  const composed = composeMcpServers()
  for (const [name, entry] of Object.entries(composed)) {
    if (!entry.enabled) continue
    const sdkEntry: Record<string, unknown> = { type: entry.type }
    if (entry.type === 'stdio') {
      sdkEntry.command = entry.command
      if (entry.args) sdkEntry.args = entry.args
      // 注入 bundled PATH 前缀，确保内建 OCR/ASR 与用户 stdio MCP 都用 bundled
      // node/uv，而不是依赖系统 nvm/PATH。已显式给 PATH 的 entry.env 也会被刷新前缀。
      const baseEnv = entry.env ?? {}
      const injectedPath = buildPathWithBundledPrefix(baseEnv.PATH ?? process.env.PATH)
      const mergedEnv: Record<string, string> = { ...baseEnv }
      if (injectedPath) mergedEnv.PATH = injectedPath
      if (Object.keys(mergedEnv).length > 0) sdkEntry.env = mergedEnv
    } else {
      sdkEntry.url = entry.url
      if (entry.headers) sdkEntry.headers = entry.headers
    }
    if (entry.timeout != null) sdkEntry.startup_timeout_sec = entry.timeout
    mcpServers[name] = sdkEntry
  }

  if (!workspaceSlug) return mcpServers

  // 内建注入：pdf_parser MCP（并行解析 PDF → 工作区 parsed-papers/{itemKey}.txt）
  if (!mcpServers.pdf_parser) {
    const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
    const serverCjs = join(base, 'pdf-parser-mcp', 'server.cjs')
    if (existsSync(serverCjs)) {
      const injectedPath = buildPathWithBundledPrefix(process.env.PATH)
      mcpServers.pdf_parser = {
        type: 'stdio',
        command: 'node',
        args: [serverCjs],
        env: {
          ...(injectedPath && { PATH: injectedPath }),
          ASCI_WORKSPACE_DIR: getAgentWorkspacePath(workspaceSlug),
        },
        required: false,
        startup_timeout_sec: 15,
      }
    } else {
      console.warn(`[Agent 编排] pdf-parser MCP server.cjs 未找到: ${serverCjs}（需先运行 build:pdf-parser-mcp）`)
    }
  }

  if (Object.keys(mcpServers).length > 0) {
    console.log(`[Agent 编排] 已加载 ${Object.keys(mcpServers).length} 个 MCP 服务器`)
  }

  return mcpServers
}

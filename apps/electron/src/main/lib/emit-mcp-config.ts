/**
 * emitMcpConfigFile — 把 master 的 mcpServers 字典写到 `<cwd>/.mcp.json`（G5 修复）。
 *
 * **必要性**：G3 文件式 fallback（commit 5cd2abfb）让 claude binary 找到 scenario sub-agent，
 * 但 sub-agent dispatch 时是另一个 claude subprocess，**不继承父级 master 的 mcpServers**。
 * SDK 文件式 agent frontmatter 又不支持 `mcpServers` 字段（spec §6.2 仅含 name/description/
 * tools/model），导致 scenario 子上下文里 `mcp__paper-search__*` 等工具全部不可见。
 *
 * 解决方案：按 Claude Code 项目级 MCP 配置约定，把 master 合成后的 mcpServers 字典写到
 * session cwd 下的 `.mcp.json`，让 claude binary（sub-agent subprocess 启动时）从 cwd
 * 自动 load 这份配置，scenario 子上下文也能调到同一批 MCP 工具。
 *
 * 行为：
 *  1. reseed 模式：每 turn 跑前重写（覆盖旧的），跟 master 的 buildMcpServers 字典同步
 *  2. JSON 格式：`{ "mcpServers": { ... } }`（Claude Code 项目级约定）
 *  3. 空字典 → 仍写一份空配置（清掉前一 turn 残留）
 *  4. 写失败 → console.warn 不阻塞主流程
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** master 用的 mcpServers 字典（同 agent-orchestrator.ts 第 1146 行 buildMcpServers 返回类型） */
export type GlobalMcpServers = Record<string, Record<string, unknown>>

export function emitMcpConfigFile(mcpServers: GlobalMcpServers, cwd: string): void {
  const mcpConfigPath = join(cwd, '.mcp.json')

  // 逐 entry 尝试 JSON.stringify：buildMcpServers 字典里的 in-process SDK MCP（
  // McpSdkServerConfig type，含 native McpServer instance）无法 JSON 序列化、
  // 且对 sub-agent subprocess 没意义（in-process 只在 master 进程内 live）。
  // 跳过这些 entry，只把可序列化的 stdio / sse / http 配置写到 .mcp.json。
  const serializable: GlobalMcpServers = {}
  for (const [name, config] of Object.entries(mcpServers)) {
    try {
      JSON.stringify(config)
      serializable[name] = config
    } catch (err) {
      console.warn(`[emitMcpConfigFile] 跳过不可序列化的 MCP "${name}"（in-process SDK type 或循环引用）`, err)
    }
  }

  const content = JSON.stringify({ mcpServers: serializable }, null, 2) + '\n'

  try {
    // 自动建父目录（cwd 应该已经存在，但兜底）
    mkdirSync(dirname(mcpConfigPath), { recursive: true })
    writeFileSync(mcpConfigPath, content, 'utf-8')
  } catch (err) {
    console.warn(`[emitMcpConfigFile] 写 ${mcpConfigPath} 失败`, err)
  }
}

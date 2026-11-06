/**
 * seedMcpServersToRegistry — 把 composeMcpServers() 输出 reseed 到 Registry 作为 'mcp' kind 元数据镜像（A2 phase2）。
 *
 * **不替换** MCP 的实际装配路径 — options.mcpServers 仍由 composeMcpServers
 * + buildMcpServers (agent-orchestrator.ts) 注入；本 seed 仅做"Registry 可枚举元数据"。
 *
 * isBuiltin === true 的 MCP → source: 'builtin'；否则 → source: 'user-config'。
 * enabled === false 的 MCP 不进 Registry。
 *
 * **reseed 模式**：调用时先 unregister 全部现有 'mcp' kind entry，再注册新一批；
 * 'subagent' / 'skill' 不受影响。每次 Agent session 启动调一次即可。
 */

import type { ComposedMcpServerEntry } from './mcp/global-config.ts'
import type { SubagentRegistry } from './subagent-registry.ts'

export function seedMcpServersToRegistry(
  registry: SubagentRegistry,
  composed: Record<string, ComposedMcpServerEntry>,
): void {
  registry.unregister((e) => e.kind === 'mcp')
  for (const [name, entry] of Object.entries(composed)) {
    if (entry.enabled === false) continue
    registry.register({
      kind: 'mcp',
      name,
      source: entry.isBuiltin ? 'builtin' : 'user-config',
      type: entry.type ?? 'stdio',
      isBuiltin: entry.isBuiltin,
    })
  }
}

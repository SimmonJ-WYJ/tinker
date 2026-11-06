/**
 * MCP init 状态解析（issue #587 诊断埋点）
 *
 * SDK 每个 turn 的 system init 消息携带 `mcp_servers`（每 server 连接状态）与
 * `tools`（本 turn 可用工具全集）。orchestrator 此前完全忽略这两个字段，
 * MCP server 连接失败只能靠下游 "No such tool available" 症状反推。
 *
 * 这里提供纯函数解析 + 快照结构，orchestrator 在 init 消息到达时调用并：
 *  1. 逐 turn 落一条结构化日志（每 server 状态 + 关键工具是否在工具表）
 *  2. 非 connected 状态 console.warn（可定位：session / server / status）
 *  3. 快照留存，供 "No such tool" 哨兵在命中时附带上下文写诊断 JSONL
 */
import type { SDKSystemMessage } from '@asci/shared'

/** 单个 MCP server 的连接状态条目 */
export interface McpServerStatusEntry {
  name: string
  /** SDK 上报的状态（connected / failed / needs-auth / pending 等），缺失记 'unknown' */
  status: string
}

/** 一次 init 消息解析出的 MCP 状态快照 */
export interface McpInitSnapshot {
  /** 快照产生时间（epoch ms），由调用方传入（保证与 orchestrator 时钟一致） */
  capturedAtMs: number
  servers: McpServerStatusEntry[]
  /** init 上报的工具全集；SDK 未带 tools 字段时为 undefined（与空数组区分） */
  tools?: string[]
}

/**
 * 从 system init 消息解析 MCP 状态快照。
 * 非 init 消息或字段缺失时返回 null（调用方跳过埋点，不报错）。
 */
export function parseMcpInitSnapshot(msg: SDKSystemMessage, capturedAtMs: number): McpInitSnapshot | null {
  if (msg.subtype !== 'init') return null
  const rawServers = Array.isArray(msg.mcp_servers) ? msg.mcp_servers : []
  const servers: McpServerStatusEntry[] = rawServers.map((s) => ({
    name: typeof s?.name === 'string' ? s.name : 'unknown',
    status: typeof s?.status === 'string' ? s.status : 'unknown',
  }))
  const tools = Array.isArray(msg.tools)
    ? msg.tools.filter((t): t is string => typeof t === 'string')
    : undefined
  // mcp_servers 与 tools 都缺失 → SDK 版本不带该信息，跳过埋点
  if (servers.length === 0 && tools === undefined) return null
  return { capturedAtMs, servers, tools }
}

/** 快照中状态非 connected 的 server 列表（全 connected 返回空数组） */
export function listUnhealthyMcpServers(snapshot: McpInitSnapshot): McpServerStatusEntry[] {
  return snapshot.servers.filter((s) => s.status !== 'connected')
}

/**
 * 判断某个工具是否在 init 工具表中。
 * init 未带 tools 字段时返回 null（无法判断，与"确定缺失"区分）。
 */
export function snapshotHasTool(snapshot: McpInitSnapshot, toolName: string): boolean | null {
  if (snapshot.tools === undefined) return null
  return snapshot.tools.includes(toolName)
}

/** 把快照压成单行日志友好的摘要，如 `paper-search=connected, zotero=failed` */
export function formatMcpSnapshotSummary(snapshot: McpInitSnapshot): string {
  if (snapshot.servers.length === 0) return '(无 MCP server)'
  return snapshot.servers.map((s) => `${s.name}=${s.status}`).join(', ')
}

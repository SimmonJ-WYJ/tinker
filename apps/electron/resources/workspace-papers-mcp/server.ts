/**
 * ASCI Workspace Papers MCP Server
 *
 * stdio 协议，两个只读工具：
 *   - workspace_papers_list: 返回当前工作区全部论文（精简字段，降低 token）
 *   - workspace_papers_get: 按 key 取单条完整条目（含 note）
 *
 * 工作区定位：从 process.env.ASCI_WORKSPACE_DIR 读取工作区绝对路径，
 * 由 agent-orchestrator.buildMcpServers 在拉起子进程时注入。
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

import { handleList, listToolDefinition } from './tools/list-papers.ts'
import { handleGet, getToolDefinition } from './tools/get-paper.ts'

const server = new Server(
  { name: 'asci-workspace-papers', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

const tools = [listToolDefinition, getToolDefinition]

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params
  try {
    const data = await dispatch(name, args ?? {})
    return { content: [{ type: 'text', text: JSON.stringify(data) }] }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({ error: { message } }) }],
    }
  }
})

async function dispatch(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'workspace_papers_list':
      return handleList()
    case 'workspace_papers_get':
      return handleGet(args as Parameters<typeof handleGet>[0])
    default:
      throw new Error(`未知工具: ${name}`)
  }
}

;(async () => {
  await server.connect(new StdioServerTransport())
})()

/**
 * ASCI PDF Parser MCP Server
 *
 * stdio 协议，一个工具：
 *   - pdf_parse_batch: 并行解析 PDF 为纯文本，带缓存
 *
 * 工作区定位：从 process.env.ASCI_WORKSPACE_DIR 读取工作区绝对路径，
 * 由 agent-orchestrator.buildMcpServers 在拉起子进程时注入。
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

import { handleParseBatch, parseBatchToolDefinition } from './tools/parse-batch.ts'

const server = new Server(
  { name: 'asci-pdf-parser', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

const tools = [parseBatchToolDefinition]

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
    case 'pdf_parse_batch':
      return handleParseBatch(args as Parameters<typeof handleParseBatch>[0])
    default:
      throw new Error(`未知工具: ${name}`)
  }
}

;(async () => {
  await server.connect(new StdioServerTransport())
})()

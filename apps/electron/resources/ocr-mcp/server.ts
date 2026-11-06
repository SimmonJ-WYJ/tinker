import { OptionalRuntimeError } from '../optional-runtime'
/**
 * ASCI OCR MCP Server
 *
 * stdio 协议，独立于 zotero-mcp。唯一工具 ocr_image，对任意路径的图片做
 * 本机 PaddleOCR v5 mobile 识别。由 Agent SDK 作为子进程拉起。
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

import { handleOcrImage, ocrImageToolDefinition, OcrImageToolError } from './tools/ocr-image.ts'

const server = new Server(
  { name: 'asci-ocr', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

const tools = [
  ocrImageToolDefinition,
]

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
  const { name, arguments: args } = req.params
  try {
    const token = req.params._meta?.progressToken
    const progress = token === undefined ? undefined : (message: string) => {
      void extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: 0, total: 1, message } }).catch(() => {})
    }
    const data = await dispatch(name, args ?? {}, progress)
    return { content: [{ type: 'text', text: JSON.stringify(data) }] }
  } catch (err) {
    if (err instanceof OcrImageToolError) {
      return {
        isError: true,
        content: [{
          type: 'text',
          text: JSON.stringify({
            code: err.code,
            message: err.message,
            details: err.details,
            retryable: err.retryable ?? false,
          }),
        }],
      }
    }
    return {
      isError: true,
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: { type: err instanceof OptionalRuntimeError ? 'optional_component_error' : 'unexpected', message: err instanceof Error ? err.message : String(err), retryable: err instanceof OptionalRuntimeError },
        }),
      }],
    }
  }
})

async function dispatch(name: string, args: Record<string, unknown>, progress?: (message: string) => void): Promise<unknown> {
  switch (name) {
    case 'ocr_image':
      return handleOcrImage(args as Parameters<typeof handleOcrImage>[0], progress)
    default:
      throw new Error(`未知工具: ${name}`)
  }
}

// 启动 stdio 传输（用 IIFE 包裹以兼容 CJS 输出格式）
;(async () => {
  await server.connect(new StdioServerTransport())
})()

import { OptionalRuntimeError } from '../optional-runtime'
/**
 * ASCI ASR MCP Server
 *
 * stdio 协议，独立于 zotero-mcp / ocr-mcp。唯一工具 asr_audio，对任意路径的
 * 音频文件做本机 sherpa-onnx + SenseVoice 识别。由 Agent SDK 作为子进程拉起。
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

import { handleAsrAudio, asrAudioToolDefinition, AsrAudioToolError } from './tools/asr-audio.ts'

const server = new Server(
  { name: 'asci-asr', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

const tools = [
  asrAudioToolDefinition,
]

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
  const { name, arguments: args } = req.params
  const progressToken = req.params._meta?.progressToken
  const sendProgress = progressToken !== undefined
    ? async (done: number, total: number): Promise<void> => {
        try {
          await extra.sendNotification({
            method: 'notifications/progress',
            params: { progressToken, progress: done, total },
          })
        } catch { /* 进度通知失败静默 */ }
      }
    : undefined
  try {
    const componentProgress = progressToken === undefined ? undefined : (message: string) => {
      void extra.sendNotification({ method: 'notifications/progress', params: { progressToken, progress: 0, total: 1, message } }).catch(() => {})
    }
    const data = await dispatch(name, args ?? {}, sendProgress, componentProgress)
    return { content: [{ type: 'text', text: JSON.stringify(data) }] }
  } catch (err) {
    if (err instanceof AsrAudioToolError) {
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

async function dispatch(
  name: string,
  args: Record<string, unknown>,
  onProgress?: (done: number, total: number) => void | Promise<void>,
  componentProgress?: (message: string) => void,
): Promise<unknown> {
  switch (name) {
    case 'asr_audio':
      return handleAsrAudio(args as Parameters<typeof handleAsrAudio>[0], onProgress, componentProgress)
    default:
      throw new Error(`未知工具: ${name}`)
  }
}

// 启动 stdio 传输（IIFE 兼容 CJS 输出格式）
;(async () => {
  await server.connect(new StdioServerTransport())
})()

/**
 * ASCI Zotero MCP Server
 *
 * stdio 协议，由 Agent SDK 作为子进程拉起。
 * 工具集：ping / search_items / get_item / list_collections / get_collection_items
 *        / get_attachment_path / read_attachment / wiki_lookup
 * OCR 已拆到独立 asci-ocr MCP server；图片附件先 get_attachment_path 拿路径，
 * 再交给 ocr_image 识别。
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

import { handlePing, pingToolDefinition } from './tools/ping.ts'
import { handleSearchItems, searchItemsToolDefinition } from './tools/search-items.ts'
import { handleGetItem, getItemToolDefinition } from './tools/get-item.ts'
import { handleListCollections, listCollectionsToolDefinition } from './tools/list-collections.ts'
import { handleGetCollectionItems, getCollectionItemsToolDefinition } from './tools/get-collection-items.ts'
import { handleGetAttachmentPath, getAttachmentPathToolDefinition } from './tools/get-attachment-path.ts'
import { handleReadAttachment, readAttachmentToolDefinition, ReadAttachmentToolError } from './tools/read-attachment.ts'
import { handleWikiLookup, wikiLookupToolDefinition, handleWikiLookupBatch, wikiLookupBatchToolDefinition } from './tools/wiki-lookup.ts'
import { ZoteroError, toErrorMessage } from '../../src/main/lib/zotero-client/errors.ts'

const server = new Server(
  { name: 'asci-zotero', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

const tools = [
  pingToolDefinition,
  searchItemsToolDefinition,
  getItemToolDefinition,
  listCollectionsToolDefinition,
  getCollectionItemsToolDefinition,
  getAttachmentPathToolDefinition,
  readAttachmentToolDefinition,
  wikiLookupToolDefinition,
  wikiLookupBatchToolDefinition,
]

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params
  try {
    const data = await dispatch(name, args ?? {})
    return { content: [{ type: 'text', text: JSON.stringify(data) }] }
  } catch (err) {
    if (err instanceof ZoteroError) {
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ error: { type: err.type, message: err.message } }) }],
      }
    }
    if (err instanceof ReadAttachmentToolError) {
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
      content: [{ type: 'text', text: JSON.stringify({ error: { type: 'unexpected', message: toErrorMessage(err) } }) }],
    }
  }
})

async function dispatch(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'zotero_ping':
      return handlePing()
    case 'zotero_search_items':
      return handleSearchItems(args as Parameters<typeof handleSearchItems>[0])
    case 'zotero_get_item':
      return handleGetItem(args as Parameters<typeof handleGetItem>[0])
    case 'zotero_list_collections':
      return handleListCollections()
    case 'zotero_get_collection_items':
      return handleGetCollectionItems(args as Parameters<typeof handleGetCollectionItems>[0])
    case 'zotero_get_attachment_path':
      return handleGetAttachmentPath(args as Parameters<typeof handleGetAttachmentPath>[0])
    case 'zotero_read_attachment':
      return handleReadAttachment(args as Parameters<typeof handleReadAttachment>[0])
    case 'zotero_wiki_lookup':
      return handleWikiLookup(args as Parameters<typeof handleWikiLookup>[0])
    case 'zotero_wiki_lookup_batch':
      return handleWikiLookupBatch(args as Parameters<typeof handleWikiLookupBatch>[0])
    default:
      throw new ZoteroError('unexpected', `未知工具: ${name}`)
  }
}

// 启动 stdio 传输（用 IIFE 包裹以兼容 CJS 输出格式）
;(async () => {
  await server.connect(new StdioServerTransport())
})()

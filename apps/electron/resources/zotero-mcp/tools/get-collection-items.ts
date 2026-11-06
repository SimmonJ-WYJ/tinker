/**
 * zotero_get_collection_items: 取指定 collection 下的条目
 */

import { fetchZotero } from '../../../src/main/lib/zotero-client/api-client.ts'
import type { ZoteroItem } from '@asci/core/zotero'
import { summarizeItem, type ItemSummary } from '@asci/core/zotero'

export interface GetCollectionItemsInput {
  collectionKey: string
  limit?: number
}

export async function handleGetCollectionItems(input: GetCollectionItemsInput): Promise<ItemSummary[]> {
  const limit = input.limit ?? 50
  const params = new URLSearchParams({ limit: String(limit), format: 'json' })
  const items = await fetchZotero<ZoteroItem[]>(`/users/0/collections/${input.collectionKey}/items?${params.toString()}`)
  return items.map(summarizeItem)
}

export const getCollectionItemsToolDefinition = {
  name: 'zotero_get_collection_items',
  description: '取指定 Zotero collection 下的条目（同 search 的摘要格式）。',
  inputSchema: {
    type: 'object',
    properties: {
      collectionKey: { type: 'string' },
      limit: { type: 'number', default: 50 },
    },
    required: ['collectionKey'],
    additionalProperties: false,
  },
} as const

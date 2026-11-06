/**
 * zotero_search_items: 关键词搜索 Zotero 库
 */

import { fetchZotero } from '../../../src/main/lib/zotero-client/api-client.ts'
import type { ZoteroItem } from '@asci/core/zotero'
import { summarizeItem, type ItemSummary } from '@asci/core/zotero'

export type { ItemSummary }

export interface SearchInput {
  query: string
  limit?: number
}

export async function handleSearchItems(input: SearchInput): Promise<ItemSummary[]> {
  const limit = input.limit ?? 20
  // 使用 %20 编码空格（URLSearchParams 默认用 + 号，Zotero API 需要 %20）
  const params = new URLSearchParams({
    q: input.query,
    qmode: 'everything',
    limit: String(limit),
    format: 'json',
  })
  const queryString = params.toString().replace(/\+/g, '%20')

  const items = await fetchZotero<ZoteroItem[]>(`/users/0/items?${queryString}`)
  return items.map(summarizeItem)
}


export const searchItemsToolDefinition = {
  name: 'zotero_search_items',
  description: '在 Zotero 库中按关键词搜索文献。返回精简的条目摘要（key/标题/作者/日期/标签/所在集合）。',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词（全字段匹配）' },
      limit: { type: 'number', description: '返回数量上限，默认 20', default: 20 },
    },
    required: ['query'],
    additionalProperties: false,
  },
} as const

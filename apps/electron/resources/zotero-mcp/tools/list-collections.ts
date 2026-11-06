/**
 * zotero_list_collections: 列出所有 collection（扁平数组 + parent 指针）
 */

import { fetchZotero } from '../../../src/main/lib/zotero-client/api-client.ts'
import type { ZoteroCollection } from '@asci/core/zotero'
import { summarizeCollection, type CollectionSummary } from '@asci/core/zotero'

export type { CollectionSummary }

export async function handleListCollections(): Promise<CollectionSummary[]> {
  const raw = await fetchZotero<ZoteroCollection[]>('/users/0/collections?format=json')
  return raw.map(summarizeCollection)
}

export const listCollectionsToolDefinition = {
  name: 'zotero_list_collections',
  description: '列出 Zotero 用户库下所有 collection（扁平数组，带 parentKey 可推导层级）。',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
} as const

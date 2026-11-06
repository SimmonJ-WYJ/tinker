/**
 * zotero_get_item: 取单条完整 item 信息
 */

import { fetchZotero } from '../../../src/main/lib/zotero-client/api-client.ts'
import type { ZoteroItem } from '@asci/core/zotero'
import { detailItem, type ItemDetail } from '@asci/core/zotero'

export type { ItemDetail }

export interface GetItemInput {
  itemKey: string
}

export async function handleGetItem(input: GetItemInput): Promise<ItemDetail> {
  const item = await fetchZotero<ZoteroItem>(`/users/0/items/${input.itemKey}?format=json`)
  return detailItem(item)
}

export const getItemToolDefinition = {
  name: 'zotero_get_item',
  description: '根据 itemKey 取单条 Zotero 条目的完整信息。',
  inputSchema: {
    type: 'object',
    properties: { itemKey: { type: 'string', description: 'Zotero item key（8 位字母数字）' } },
    required: ['itemKey'],
    additionalProperties: false,
  },
} as const
